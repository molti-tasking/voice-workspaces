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
 * Which of the three invited use cases a drive was started from, if any.
 *
 * WHY THIS IS RECORDED. The peer week hands people three worked examples on
 * `/welcome`, because two of them told us plainly they could not start without
 * one ("I didn't really know what it could do so I didn't know how to get
 * started"). Seeding examples is a real cost to the repertoire claim — a
 * capability the user was shown is not one they grew — so the seeding has to be
 * visible in the data rather than remembered afterwards. With this column,
 * "which example did they pick, and which did they abandon after one drive" is
 * a count; without it, it is an anecdote.
 *
 * NULL for every drive started any other way: straight from `/record`, from a
 * bookmark, or before this existed. That is the unseeded case, and it is the
 * one the longitudinal deployment will be made entirely of.
 *
 * Immutable per recording, like `voiceId`, for the same reason:
 * it describes the intent a drive began under, and a drive whose second half
 * claims a different one is not interpretable.
 *
 * - `think_aloud`  work a problem out; end by moving something on the board
 * - `draft`        get text you can paste, then change it by voice
 * - `recall`       come back the next day and pick up the thread
 */
export const CaptureUseCase = z.enum(["think_aloud", "draft", "recall"]);
export type CaptureUseCase = z.infer<typeof CaptureUseCase>;

/**
 * The ways a drive's conversation can be shown on the phone, as the display
 * study compares them (the study session, `/study/session`):
 *
 * - `transcript`: every line as it was said, the way a voice assistant's chat
 *   shows a voice conversation — the control.
 * - `conversation`: the column in order with topic headlines and signals
 *   (`ConversationFlow`).
 * - `track`, `bubbles`: the conversation mirror's two layouts
 *   (`ConversationMirror`).
 */
export const CONVERSATION_DISPLAYS = ["transcript", "conversation", "track", "bubbles"] as const;
export const ConversationDisplay = z.enum(CONVERSATION_DISPLAYS);
export type ConversationDisplay = z.infer<typeof ConversationDisplay>;

/**
 * The behaviours the field study varies, for one drive.
 *
 * Researcher-set on `user.study_condition`, copied RESOLVED onto
 * `capture_session.study_condition` when a drive opens, and never changed on
 * that row again — see the column comments for why both halves matter.
 *
 * EVERY DEFAULT IS TODAY'S BEHAVIOUR. An empty object, a null template and a
 * drive that predates conditions all mean "the system as it shipped", so
 * turning the study on changes nothing until someone writes a field.
 *
 * Varied per participant and phase, not per container: one Pipecat container
 * serves every drive, and an environment variable cannot tell two participants
 * apart. Two arms were chosen (EVALUATION_PLAN.md §5.1); the flags for them
 * exist before the behaviours do so assignment can be tested now, and they do
 * nothing until those behaviours land. Adding a field later is additive: old
 * rows parse with its default.
 *
 * Strict, so an unknown key is an error rather than ignored. `agendaOffer:
 * true` (no s) would otherwise parse cleanly into the control arm, and nobody
 * would find out until the analysis.
 */
export const StudyCondition = z.strictObject({
  /**
   * Whether the container offers unprompted turns out of silence (`Offers` in
   * bot.py). Replaces the container-wide `PROACTIVE_OFFERS`, which remains
   * only as the fallback for a drive whose session call failed.
   */
  proactiveOffers: z.boolean().default(true),
  /** Opening, re-entry and transition offers sized to the drive (T2.5). Inert until built. */
  agendaOffers: z.boolean().default(false),
  /** Offer a detected macro by voice rather than only on /repertoire (T2.8). Inert until built. */
  voiceMacroOffers: z.boolean().default(false),
  /**
   * Whether the recorder offers sparks — short questions about one subject the
   * person can pull for the agent to ask (talkback-21, the sparks plan). On by
   * default since 21 Oct 2026: one app for everyone, with the conversation
   * mirror as a view of it. Off, the signals are still worked out and kept;
   * only the chips and the spark pokes go. A condition that says
   * `sparks: false` (the Prolific control arm) still turns them off.
   */
  sparks: z.boolean().default(true),
  /**
   * WHO PICKS THE SUBJECTS a spark is offered on, with `sparks` on.
   *
   * - `suggested`: the signals do, as the sparks first shipped (`signals.ts`).
   * - `chosen`: the person does. They KEEP the subjects they want to hold in
   *   their own head — a tap, or "keep this one" — and sparks are offered on
   *   those and nothing else; Souffleur holds the rest. The deployment's
   *   question is how choosing feels against being prompted.
   * - `alternate`: one, then the other, day by day from `alternateFrom`, in
   *   `STUDY_TIME_ZONE`, starting with `alternateStart`. A drive is frozen to
   *   the day it STARTED on (`freezeStudyCondition`), so `capture_session`
   *   only ever holds `suggested` or `chosen`.
   */
  sparkSelection: z.enum(["suggested", "chosen", "alternate"]).default("suggested"),
  /** For `alternate`: its first day, `YYYY-MM-DD`. Unset, every drive is a first day. */
  alternateFrom: z.iso.date().optional(),
  /** For `alternate`: the first day's mode. The next day is the other one. */
  alternateStart: z.enum(["suggested", "chosen"]).default("suggested"),
  /**
   * How the conversation is shown during the drive. `choice`: as the person
   * picked it on the recorder (Conversation, Mirror, Bubbles), which is what
   * every drive did before the display study. Anything else is forced, and the
   * recorder hides its switch — set per block by the study session.
   */
  display: z.enum(["choice", ...CONVERSATION_DISPLAYS]).default("choice"),
});
export type StudyCondition = z.infer<typeof StudyCondition>;

/** What a drive actually runs under: never `alternate`. */
export type SparkSelection = "suggested" | "chosen";

/** The calendar date of `at` in `timeZone`, as `YYYY-MM-DD`. */
export function localDate(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is what makes this a one-liner.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  const utc = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * The selection a drive starting at `at` runs under.
 *
 * `alternate` flips every calendar day in `timeZone` — the study's day, not
 * UTC's, or a drive at 00:30 in Copenhagen would land in yesterday's mode.
 * A day before `alternateFrom` counts backwards, so it still alternates.
 */
export function sparkSelectionOn(
  condition: Pick<StudyCondition, "sparkSelection" | "alternateFrom" | "alternateStart">,
  at: Date,
  timeZone: string,
): SparkSelection {
  if (condition.sparkSelection !== "alternate") return condition.sparkSelection;
  const today = localDate(at, timeZone);
  const day = daysBetween(condition.alternateFrom ?? today, today);
  const other: SparkSelection = condition.alternateStart === "suggested" ? "chosen" : "suggested";
  return ((day % 2) + 2) % 2 === 0 ? condition.alternateStart : other;
}

/**
 * The condition as a drive keeps it: `alternate` replaced by the day's mode.
 *
 * Frozen when the drive is registered, like every other field of the
 * condition (`capture_session.study_condition`), so a drive that runs past
 * midnight keeps the mode it began in and the analysis never has to work the
 * day out again.
 */
export function freezeStudyCondition(
  condition: StudyCondition,
  at: Date,
  timeZone: string,
): StudyCondition {
  return { ...condition, sparkSelection: sparkSelectionOn(condition, at, timeZone) };
}

/**
 * A stored condition, resolved, never throwing.
 *
 * Read on the recorder's path, where a hand-edited template with a typo must
 * not stop a drive from being registered. `ok: false` means the value did not
 * parse and the defaults stand in — the caller logs that, loudly, because a
 * participant silently running the wrong arm is a lost phase.
 */
export function resolveStudyCondition(
  stored: unknown,
): { ok: true; condition: StudyCondition } | { ok: false; condition: StudyCondition } {
  const parsed = StudyCondition.safeParse(stored ?? {});
  return parsed.success
    ? { ok: true, condition: parsed.data }
    : { ok: false, condition: StudyCondition.parse({}) };
}

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
  /**
   * The voice the system speaks with, as an ElevenLabs voice id.
   *
   * A free string here because this package owns the wire format and
   * `@voicemural/talkback/voice` owns the catalogue; the route narrows it to a
   * known voice and stores null for anything else. Immutable per recording,
   * so a drive was heard in one voice throughout.
   */
  voiceId: z.string().min(1).max(64).optional(),
  /**
   * The language the drive is transcribed in, as a BCP-47 code.
   *
   * Same shape and same narrowing as `voiceId` — the catalogue lives in
   * `@voicemural/talkback/language`, the route nulls anything it does not
   * name. Null/auto-detect is the default and the right one for a mixed
   * corpus; forcing a code is for a monolingual drive, where detection on a
   * short utterance can misfire. Immutable per recording, and it governs BOTH
   * transcription paths — the live STT and the ledger Whisper.
   *
   * Max 35 is BCP-47's own outer bound (grandfathered tags); the catalogue's
   * codes are all two letters.
   */
  sttLanguage: z.string().min(2).max(35).optional(),
  /** Which worked example on `/welcome` started this drive. See `CaptureUseCase`. */
  useCase: CaptureUseCase.optional(),
  /**
   * A per-drive override of the participant's study condition.
   *
   * Sparse: only the flags named are changed, the rest come from
   * `user.study_condition` as always. It exists for the cold-start test the
   * next pilot needs — the same person, two drives an hour apart, agenda
   * offers on in one and off in the other — which the per-participant template
   * cannot express without a database write between them.
   *
   * HONOURED ONLY FOR PILOT ACCOUNTS (`STUDY_PILOT_USER_IDS`), and the route
   * says so in the log when it drops one. A participant whose arm could be
   * flipped from the browser is a participant whose phase cannot be analysed,
   * and a client is not a trustworthy place to decide a study condition.
   */
  conditionOverride: StudyCondition.partial().optional(),
  deviceInfo: z
    .object({
      userAgent: z.string().max(512).optional(),
      mimeType: z.string().max(128).optional(),
      platform: z.string().max(128).optional(),
      /** The browser's IANA zone, so the agent can tell them the time where
       * they are. Validated where it is read (`timeZoneOf`), not here: a zone
       * this server cannot format is simply not known. */
      timeZone: z.string().max(64).optional(),
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
