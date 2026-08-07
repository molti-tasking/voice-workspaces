import type { RelativeSegment } from "@voicemural/shared";
import { LiteLLMError, litellmConfig, modelFor } from "./config";

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
  },
): Promise<TranscriptionResult> {
  const { baseUrl, apiKey } = litellmConfig();
  const endpoint = `${baseUrl}/audio/transcriptions`;

  const form = new FormData();
  // Copy into a fresh ArrayBuffer: a Uint8Array view over a pooled Node Buffer
  // can carry the whole slab, uploading far more bytes than the chunk.
  const bytes = new Uint8Array(audio.byteLength);
  bytes.set(audio);
  form.append("file", new Blob([bytes], { type: options.mimeType }), options.filename);
  form.append("model", modelFor("transcribe"));
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  if (options.prompt) form.append("prompt", options.prompt.slice(-800));
  if (options.language) form.append("language", options.language);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: options.signal,
  });

  if (!res.ok) {
    throw new LiteLLMError(res.status, await res.text(), "/audio/transcriptions");
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

  return {
    text,
    segments,
    language: json.language,
    durationSec: json.duration,
  };
}
