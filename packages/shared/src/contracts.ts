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

/**
 * Where the recording is happening.
 *
 * Chosen once, before the recording starts, and immutable for its duration: it
 * governs turn-taking and how much may go on screen, and both of those have to
 * be interpretable for the whole session afterwards. Mirrors
 * `SETTINGS` in `@voicemural/talkback/setting` — that package owns the
 * profiles, this one owns the wire format.
 */
export const CaptureSetting = z.enum(["driving", "walking", "hands_busy", "desk"]);
export type CaptureSetting = z.infer<typeof CaptureSetting>;

/**
 * Container families we can persist and decode, codec parameters allowed —
 * `MediaRecorder.isTypeSupported` answers for the bare container, but some
 * engines then report the chosen type with a `;codecs=…` suffix. Anything
 * outside these families would be stored under a `.bin` extension the
 * transcription pipeline would then have to guess at.
 */
const KNOWN_AUDIO_MIME = /^audio\/(webm|mp4|mpeg|ogg|wav|x-wav)(;.+)?$/;

export const CaptureSessionCreate = z.object({
  /** Client-generated UUID so the recorder can queue chunks before the server replies. */
  id: z.uuid(),
  /**
   * Sanity bounds only, not freshness: a drive that starts offline registers
   * late, so the stamp can trail `now` by as long as the dead zone lasts. A
   * date outside this window is clock garbage, and garbage here poisons every
   * `startedAt + offset` computation downstream.
   */
  startedAt: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.UTC(2024, 0, 1), "startedAt is implausibly old")
    .refine((d) => d.getTime() < Date.now() + 24 * 60 * 60 * 1000, "startedAt is in the future"),
  /** Optional: recordings made before the question existed have none. */
  setting: CaptureSetting.optional(),
  /**
   * The voice the system speaks with, as an ElevenLabs voice id.
   *
   * A free string here because this package owns the wire format and
   * `@voicemural/talkback/voice` owns the catalogue; the route narrows it to a
   * known voice and stores null for anything else. Immutable per recording,
   * like `setting`, so a drive was heard in one voice throughout.
   */
  voiceId: z.string().min(1).max(64).optional(),
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
  /**
   * The container the recorder picked (`pickMimeType`), persisted with the
   * chunk and used as the transcription request's container assumption. A
   * free string would let a client claim `audio/mp4` for webm bytes and have
   * the pipeline decode them under the wrong assumption.
   */
  mimeType: z
    .string()
    .min(1)
    .max(128)
    .refine((v) => KNOWN_AUDIO_MIME.test(v), "unsupported audio container"),
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
  workspaceExtract: "workspace.extract",
  detectMacros: "detect.macros",
  indexMemory: "memory.index",
} as const;

export const WorkspaceExtractPayload = z.object({ userId: z.string() });
export type WorkspaceExtractPayload = z.infer<typeof WorkspaceExtractPayload>;

export const TranscribeChunkPayload = z.object({ chunkId: z.string() });
export type TranscribeChunkPayload = z.infer<typeof TranscribeChunkPayload>;

/**
 * One chunk's worth of utterances to classify as content or direction.
 *
 * `userId` rides along even though the handler could re-derive it from the
 * chunk: the classifier needs it for the repertoire vocabulary, and sending
 * it saves a query on the hot path.
 */
export const ClassifyUtterancePayload = z.object({ chunkId: z.string(), userId: z.string() });
export type ClassifyUtterancePayload = z.infer<typeof ClassifyUtterancePayload>;

export const DetectMacrosPayload = z.object({ userId: z.string() });
export type DetectMacrosPayload = z.infer<typeof DetectMacrosPayload>;
