import { z } from "zod";

/**
 * Contracts crossing the web <-> worker <-> recorder boundaries.
 *
 * Seam A (capture) and Seam B (pipeline) meet here and at the `utterance`
 * table. Changing anything in this file is a two-person decision.
 */

/** Audio containers we accept. Chrome/Android emit webm/opus; Safari emits mp4. */
export const AudioMimeType = z.enum([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
]);
export type AudioMimeType = z.infer<typeof AudioMimeType>;

/** File extension to persist a chunk under, keyed by container. */
export function extensionForMime(mime: string): string {
  if (mime.startsWith("audio/webm")) return "webm";
  if (mime.startsWith("audio/mp4")) return "m4a";
  if (mime.startsWith("audio/mpeg")) return "mp3";
  if (mime.startsWith("audio/ogg")) return "ogg";
  // Not produced by the recorder, but used by the fixture seed.
  if (mime.startsWith("audio/wav") || mime.startsWith("audio/x-wav")) return "wav";
  return "bin";
}

export const CaptureSessionCreate = z.object({
  /** Client-generated UUID so the recorder can queue chunks before the server replies. */
  id: z.uuid(),
  startedAt: z.coerce.date(),
  deviceInfo: z
    .object({
      userAgent: z.string().max(512).optional(),
      mimeType: z.string().max(128).optional(),
      platform: z.string().max(128).optional(),
    })
    .default({}),
});
export type CaptureSessionCreate = z.infer<typeof CaptureSessionCreate>;

/**
 * Chunk upload metadata. Sent as multipart fields alongside the audio blob.
 *
 * `startOffsetMs` is computed by the recorder from session start, NOT from
 * upload time — chunks buffered offline may arrive out of order or minutes
 * late, and provenance depends on these offsets being monotonic.
 */
export const ChunkUploadMeta = z.object({
  seq: z.coerce.number().int().min(0),
  startOffsetMs: z.coerce.number().int().min(0),
  durationMs: z.coerce.number().int().min(0),
  mimeType: z.string().min(1).max(128),
});
export type ChunkUploadMeta = z.infer<typeof ChunkUploadMeta>;

export const ChunkUploadResponse = z.object({
  chunkId: z.string(),
  seq: z.number().int(),
  /** True when this seq was already stored — the recorder should drop its local copy. */
  duplicate: z.boolean(),
});
export type ChunkUploadResponse = z.infer<typeof ChunkUploadResponse>;

/** How an utterance was classified. `unclassified` is the honest default. */
export const UtteranceKind = z.enum(["content", "directive", "unclassified"]);
export type UtteranceKind = z.infer<typeof UtteranceKind>;

export const CapabilityType = z.enum(["mode", "persona", "action", "rule"]);
export type CapabilityType = z.infer<typeof CapabilityType>;

/** How a capability entered the repertoire. This is paper data, not telemetry. */
export const CapabilityOriginKind = z.enum([
  "starter",
  "crystallisation",
  "reflexive",
]);
export type CapabilityOriginKind = z.infer<typeof CapabilityOriginKind>;

/** A span of derived text traced back to its source utterance. */
export const ProvenanceSpan = z.object({
  utteranceId: z.string(),
  startChar: z.number().int().min(0),
  endChar: z.number().int().min(0),
});
export type ProvenanceSpan = z.infer<typeof ProvenanceSpan>;

/** Job names. Keep in sync with apps/worker handlers. */
export const JOBS = {
  transcribeChunk: "transcribe.chunk",
  classifyUtterance: "classify.utterance",
  invokeCapability: "invoke.capability",
  evaluateRules: "evaluate.rules",
  exportOutlet: "export.outlet",
} as const;

export const TranscribeChunkPayload = z.object({ chunkId: z.string() });
export type TranscribeChunkPayload = z.infer<typeof TranscribeChunkPayload>;

export const EvaluateRulesPayload = z.object({ captureSessionId: z.string() });
export type EvaluateRulesPayload = z.infer<typeof EvaluateRulesPayload>;
