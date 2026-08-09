import type { RelativeSegment } from "@voicemural/shared";
import { LiteLLMError, litellmConfig, modelFor } from "./config";
import { emitGeneration, type GenerationContext } from "./observe";

export interface TranscriptionResult {
  /** Full text of the chunk, as returned by the model. */
  text: string;
  /** Segments with timestamps RELATIVE to this chunk, in seconds. */
  segments: RelativeSegment[];
  language?: string;
  durationSec?: number;
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
  },
): Promise<TranscriptionResult> {
  const { baseUrl, apiKey } = litellmConfig();
  const endpoint = `${baseUrl}/audio/transcriptions`;
  const model = modelFor("transcribe");

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

  const context = options.context ?? {};
  const startedAt = Date.now();

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
      spanName: "transcribe_chunk",
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
      spanName: "transcribe_chunk",
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
  const text = (json.text ?? "").trim();

  // Not every backend honours verbose_json. Falling back to one whole-chunk
  // segment keeps the pipeline working with degraded (chunk-level) provenance
  // rather than dropping the audio entirely.
  const rawSegments = json.segments ?? [];
  const segments: RelativeSegment[] =
    rawSegments.length > 0
      ? rawSegments.map((s) => ({
          start: s.start ?? 0,
          end: s.end ?? s.start ?? 0,
          text: s.text ?? "",
        }))
      : text
        ? [{ start: 0, end: json.duration ?? 0, text }]
        : [];

  emitGeneration({
    spanName: "transcribe_chunk",
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
      ...context.extra,
    },
  });

  return {
    text,
    segments,
    language: json.language,
    durationSec: json.duration,
  };
}

/** Undefined rather than 0: a zero is indistinguishable from a free call. */
function parseCostHeader(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
