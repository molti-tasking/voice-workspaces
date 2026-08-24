import { z } from "zod";

/**
 * The talk-back WebSocket protocol.
 *
 * Deliberately NOT in contracts.ts. That file carries the capture seam — the
 * recorder/worker/ledger boundary — and says changing it is a two-person
 * decision. This protocol is disposable by design: it carries a live
 * conversation that is never replayed, and it must be free to change without
 * touching the contract that the verbatim ledger depends on.
 *
 * Shape: JSON text frames for control, raw binary frames for PCM. Audio is
 * streamed WHILE the user is still speaking, so at endpoint only the tail is in
 * flight rather than the whole utterance.
 */

/**
 * Audio the client sends up.
 *
 * 16kHz mono PCM16 little-endian: what faster-whisper wants, and what the
 * server can wrap in a 44-byte WAV header with no encoder, no muxer and no
 * native dependency. 32 KB/s while speaking only — about 23 MB across a
 * 40-minute drive at 30% speech, which is acceptable before Opus (Phase 7).
 */
export const LIVE_SAMPLE_RATE = 16_000;
export const LIVE_BYTES_PER_SAMPLE = 2;

/**
 * Longest utterance the server will buffer, in ms.
 *
 * A cap rather than a preference: without it, a client that never sends
 * `utterance_end` — crashed tab, bug in the VAD, hostile input — grows a
 * server-side buffer without limit. At 15s this is 480 KB per connection.
 *
 * Note this is NOT a latency lever on this deployment. ASR was measured at
 * ~728ms fixed + 217ms/s, so request overhead dominates and shortening
 * utterances buys very little; see scripts/spike-talkback.mjs.
 */
export const MAX_UTTERANCE_MS = 15_000;
export const MAX_UTTERANCE_BYTES =
  (MAX_UTTERANCE_MS / 1000) * LIVE_SAMPLE_RATE * LIVE_BYTES_PER_SAMPLE;

/* ---------------------------------------------------------------------------
 * Client -> server
 * ------------------------------------------------------------------------ */

/**
 * Opens the conversation. Sent once, immediately after the socket opens.
 *
 * `captureSessionId` is the drive this conversation belongs to. The server
 * re-resolves ownership from `capture_session.userId` rather than trusting the
 * ticket alone, because a guest upgrading to a real account mid-drive deletes
 * the guest user row and leaves any socket holding a stale id.
 */
export const RtHello = z.object({
  type: z.literal("hello"),
  captureSessionId: z.uuid(),
  /** What the client's tap actually produced, so a mismatch is loud not silent. */
  sampleRate: z.number().int().positive(),
  /** Recorded per session so a drive's numbers stay interpretable later. */
  vadEngine: z.string().max(64).optional(),
});

/** A speech segment is opening. Audio frames follow until `utterance_end`. */
export const RtUtteranceStart = z.object({
  type: z.literal("utterance_start"),
  /** Monotonic per connection. Ties audio, transcript and errors together. */
  seq: z.number().int().min(0),
  /** Client clock, ms since recording start — the same axis as utterance offsets. */
  startOffsetMs: z.number().int().min(0),
});

/** Endpoint reached. Transcribe what has arrived for this `seq`. */
export const RtUtteranceEnd = z.object({
  type: z.literal("utterance_end"),
  seq: z.number().int().min(0),
  durationMs: z.number().int().min(0),
});

/**
 * Abandon an utterance without transcribing it.
 *
 * Sent when the VAD retracts — too short to be speech, or a speculative start
 * that turned out to be road noise. Cheaper than letting the server transcribe
 * a cough, and it keeps the ASR queue for turns that matter.
 */
export const RtUtteranceCancel = z.object({
  type: z.literal("utterance_cancel"),
  seq: z.number().int().min(0),
  reason: z.enum(["too_short", "retracted"]).optional(),
});

/**
 * The user started talking over the system.
 *
 * The client stops playing LOCALLY and instantly — it never waits for this
 * message to round-trip — and then reports how far it had got. `playedMs` is
 * what makes the ledger honest: `agent_turn.text` records what was actually
 * heard, not what was generated, and how often a user interrupts and how far
 * into a reply is precisely the turn-taking data `mode` claims to govern.
 */
export const RtBargeIn = z.object({
  type: z.literal("barge_in"),
  turnId: z.string(),
  /** Milliseconds of the reply actually played before being cut off. */
  playedMs: z.number().int().min(0),
});

export const RtPing = z.object({ type: z.literal("ping") });

export const RtClientMessage = z.discriminatedUnion("type", [
  RtHello,
  RtUtteranceStart,
  RtUtteranceEnd,
  RtUtteranceCancel,
  RtBargeIn,
  RtPing,
]);
export type RtClientMessage = z.infer<typeof RtClientMessage>;

/* ---------------------------------------------------------------------------
 * Server -> client
 * ------------------------------------------------------------------------ */

export const RtReady = z.object({
  type: z.literal("ready"),
  /** Server-side conversation id. Distinct from the drive: a reconnect resumes. */
  conversationId: z.string(),
  /** Echoed so the client can log what the server believes it is receiving. */
  sampleRate: z.number().int().positive(),
});

/**
 * What the live ASR heard.
 *
 * This is a WORKING COPY and is never written to the `utterance` ledger — the
 * chunk pipeline transcribes the same speech independently, and writing both
 * would leave two divergent transcripts of one drive. It exists so the agent
 * has something to respond to, and so the driver can see that they were heard.
 */
export const RtTranscript = z.object({
  type: z.literal("transcript"),
  seq: z.number().int().min(0),
  text: z.string(),
  startOffsetMs: z.number().int().min(0),
  /** Endpoint to transcript, measured server-side. */
  latencyMs: z.number().int().min(0),
});

/**
 * The system is about to take a turn.
 *
 * Sent before any text, so the UI can show that a reply is coming and the
 * client can duck anything it is playing. Separated from the text itself
 * because the gap between "thinking" and "the first word" is the part of the
 * latency the user actually feels.
 */
export const RtTurnStart = z.object({
  type: z.literal("turn_start"),
  turnId: z.string(),
  /** What the system understood itself to be answering. */
  respondingTo: z.string().optional(),
});

/**
 * A fragment of the system's reply, as the model produces it.
 *
 * Streamed rather than sent whole so the client can begin showing — and later
 * speaking — the opening clause while the rest is still being generated.
 */
export const RtTurnDelta = z.object({
  type: z.literal("turn_delta"),
  turnId: z.string(),
  delta: z.string(),
});

export const RtTurnEnd = z.object({
  type: z.literal("turn_end"),
  turnId: z.string(),
  text: z.string(),
  /** Time to the first token: the number that decides whether this felt fast. */
  ttftMs: z.number().int().min(0).optional(),
  totalMs: z.number().int().min(0),
});

/**
 * The user interrupted, so stop playing immediately.
 *
 * Client-initiated in the other direction too — see `RtBargeIn`. This is the
 * server acknowledging, and telling the client the turn is over.
 */
export const RtTurnAborted = z.object({
  type: z.literal("turn_aborted"),
  turnId: z.string(),
  reason: z.enum(["barge_in", "disconnect", "error"]),
});

/**
 * Audio for a turn is about to stream, as binary frames.
 *
 * The rate is declared here rather than inferred: the frames are headerless
 * PCM16, and a player that guesses wrong plays the reply at the wrong pitch.
 */
export const RtAudioStart = z.object({
  type: z.literal("audio_start"),
  turnId: z.string(),
  sampleRate: z.number().int().positive(),
});

/**
 * No more audio for this turn.
 *
 * `durationMs` is the full length that was sent, which is what the client
 * compares its own consumed-sample count against when reporting how much was
 * actually heard.
 */
export const RtAudioEnd = z.object({
  type: z.literal("audio_end"),
  turnId: z.string(),
  durationMs: z.number().int().min(0),
});

export const RtError = z.object({
  type: z.literal("error"),
  message: z.string(),
  /** Which utterance failed, when it was one. */
  seq: z.number().int().min(0).optional(),
  /** True when the connection is about to close and retrying will not help. */
  fatal: z.boolean().default(false),
});

export const RtPong = z.object({ type: z.literal("pong") });

export const RtServerMessage = z.discriminatedUnion("type", [
  RtReady,
  RtTranscript,
  RtTurnStart,
  RtTurnDelta,
  RtTurnEnd,
  RtTurnAborted,
  RtAudioStart,
  RtAudioEnd,
  RtError,
  RtPong,
]);
export type RtServerMessage = z.infer<typeof RtServerMessage>;

/**
 * Application-level keepalive interval.
 *
 * Not redundant with WebSocket ping frames: idle-timeout behaviour on a
 * Coolify-managed Traefik is not documented anywhere we control, and a socket
 * that silently dies after N minutes idle is exactly the failure nobody wants
 * to discover on the motorway.
 */
export const RT_HEARTBEAT_MS = 15_000;

/** Path the realtime service is mounted at, on the same origin as the web app. */
export const RT_PATH = "/rt";
