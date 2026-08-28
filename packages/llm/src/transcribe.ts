import type { RelativeSegment } from "@voicemural/shared";
import { LiteLLMError, litellmConfig, modelFor, type ModelRole } from "./config";
import { emitGeneration, type GenerationContext } from "./observe";
import { collapseRepeats, isDegenerate, repetitionRatio } from "./transcript-repair";

export interface TranscriptionResult {
  /** Full text of the chunk, with repetition loops repaired. */
  text: string;
  /** Segments with timestamps RELATIVE to this chunk, in seconds. */
  segments: RelativeSegment[];
  language?: string;
  durationSec?: number;
  /**
   * True when the model degenerated into repeating itself and the output was
   * mostly artefact.
   *
   * Callers should NOT carry a degenerate transcript forward as the next
   * chunk's continuity prompt: feeding the artefact back is what makes the loop
   * sustain itself across a whole drive.
   */
  degenerate: boolean;
}

interface VerboseJsonResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: { start?: number; end?: number; text?: string }[];
}

/**
 * Transcribe one audio chunk via LiteLLM's OpenAI-compatible
 * `/audio/transcriptions` endpoint.
 *
 * Requests `verbose_json` because we need segment timestamps — plain text would
 * give us the words but destroy provenance, and the offsets cannot be recovered
 * afterwards.
 *
 * Returned timestamps are chunk-relative; lifting them onto the session
 * timeline is `toAbsoluteSegments`' job.
 */
export async function transcribeChunk(
  audio: Uint8Array,
  options: {
    filename: string;
    mimeType: string;
    /** Prior text, which measurably improves continuity across chunk boundaries. */
    prompt?: string;
    language?: string;
    signal?: AbortSignal;
    /**
     * Identifiers for observability only; ignored by the model call.
     *
     * Passed in rather than inferred because nothing else in this function
     * knows which chunk, drive or user it is working for, and an unattributed
     * generation cannot be joined to anything.
     */
    context?: GenerationContext;
    /**
     * Which ASR deployment to use. Defaults to the ledger's.
     *
     * The live conversation passes `transcribe_live` so its turns do not queue
     * behind the chunk pipeline's batched jobs — see the note on ROLE_FALLBACK
     * in config.ts. Nothing else about the call differs.
     */
    role?: Extract<ModelRole, "transcribe" | "transcribe_live">;
  },
): Promise<TranscriptionResult> {
  const { baseUrl, apiKey } = litellmConfig();
  const endpoint = `${baseUrl}/audio/transcriptions`;
  const role = options.role ?? "transcribe";
  const model = modelFor(role);

  const form = new FormData();
  // Copy into a fresh ArrayBuffer: a Uint8Array view over a pooled Node Buffer
  // can carry the whole slab, uploading far more bytes than the chunk.
  const bytes = new Uint8Array(audio.byteLength);
  bytes.set(audio);
  form.append("file", new Blob([bytes], { type: options.mimeType }), options.filename);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  // Truncated here, so this is what the model actually conditions on — log this
  // rather than the caller's untruncated text.
  const sentPrompt = options.prompt?.slice(-800);
  if (sentPrompt) form.append("prompt", sentPrompt);
  if (options.language) form.append("language", options.language);

  /* Two settings against Whisper's habit of inventing YouTube.
   *
   * `temperature: 0` makes decoding greedy. Left unset, the server is free to
   * sample, and on quiet or near-silent audio it samples fluent nonsense from
   * its training distribution.
   *
   * `condition_on_previous_text: false` is the one that matters. Whisper
   * conditions each segment on the segments it has already produced WITHIN this
   * file, so one bad guess feeds the next and the output locks into a loop —
   * "I will show you how to make a simple, easy, and easy to make I will show
   * you how to make ...". Real drives produced exactly that, five chunks in
   * nine, and the repetition guard downstream could only tidy the wreckage.
   *
   * This is NOT the same knob as `prompt` above. That one is the caller's
   * cross-chunk continuity and is still sent; this one is Whisper feeding on
   * itself inside a single chunk. Verified accepted by the deployment — all
   * four combinations answered 200 against a real clip. */
  form.append("temperature", "0");
  form.append("condition_on_previous_text", "false");

  const context = options.context ?? {};
  const startedAt = Date.now();
  // Separate span names so the live path's latency is not averaged together
  // with the ledger's in AI Observability — they have different models,
  // different queues, and only one of them has a user waiting on it.
  const spanName = role === "transcribe_live" ? "transcribe_live" : "transcribe_chunk";

  /** Audio has no text form, so stand in for it with what was actually sent. */
  const describeInput = () => [
    ...(sentPrompt ? [{ role: "system", content: sentPrompt }] : []),
    {
      role: "user",
      content: `[audio] ${options.filename}, ${options.mimeType}, ${audio.byteLength} bytes`,
    },
  ];

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: options.signal,
    });
  } catch (err) {
    // A dead proxy or an aborted request never reaches the !res.ok branch, and
    // is exactly the failure worth seeing in AI Observability.
    emitGeneration({
      spanName,
      model,
      latencyMs: Date.now() - startedAt,
      context,
      input: describeInput(),
      error: err instanceof Error ? err.message : String(err),
      properties: { audio_bytes: audio.byteLength, ...context.extra },
    });
    throw err;
  }

  if (!res.ok) {
    const body = await res.text();
    emitGeneration({
      spanName,
      model,
      latencyMs: Date.now() - startedAt,
      context,
      input: describeInput(),
      httpStatus: res.status,
      error: body.slice(0, 500),
      properties: { audio_bytes: audio.byteLength, ...context.extra },
    });
    throw new LiteLLMError(res.status, body, "/audio/transcriptions");
  }

  const json = (await res.json()) as VerboseJsonResponse;
  const rawText = (json.text ?? "").trim();

  // Repair before anything else sees it. Whisper locks onto a phrase on quiet
  // or truncated audio and repeats it — hundreds of words the speaker never
  // said, written straight into the append-only ledger.
  const text = collapseRepeats(rawText);
  const degenerate = isDegenerate(rawText, text);

  // Not every backend honours verbose_json. Falling back to one whole-chunk
  // segment keeps the pipeline working with degraded (chunk-level) provenance
  // rather than dropping the audio entirely.
  const rawSegments = json.segments ?? [];
  const segments: RelativeSegment[] = (
    rawSegments.length > 0
      ? rawSegments.map((s) => ({
          start: s.start ?? 0,
          end: s.end ?? s.start ?? 0,
          text: collapseRepeats(s.text ?? ""),
        }))
      : text
        ? [{ start: 0, end: json.duration ?? 0, text }]
        : []
  ).filter((segment) => segment.text.trim().length > 0);

  emitGeneration({
    spanName,
    model,
    latencyMs: Date.now() - startedAt,
    context,
    input: describeInput(),
    output: text,
    httpStatus: res.status,
    costUsd: parseCostHeader(res.headers.get("x-litellm-response-cost")),
    properties: {
      audio_bytes: audio.byteLength,
      audio_duration_sec: json.duration,
      segment_count: segments.length,
      language: json.language,
      // A data-quality signal worth having in the record: how often the ASR
      // degenerates, and on what, is a finding about the corpus rather than
      // only an operational detail.
      repetition_ratio: Number(repetitionRatio(rawText, text).toFixed(3)),
      degenerate,
      ...context.extra,
    },
  });

  return {
    text,
    segments,
    language: json.language,
    durationSec: json.duration,
    degenerate,
  };
}

/** Undefined rather than 0: a zero is indistinguishable from a free call. */
function parseCostHeader(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
