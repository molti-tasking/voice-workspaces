/**
 * Live turns into Langfuse, for the speech-to-speech engine.
 *
 * WHY THIS EXISTS. Live tracing used to come from the Pipecat container alone
 * (`setup_langfuse_tracing` in bot.py). Since the drives moved to the
 * speech-to-speech engine (`NEXT_PUBLIC_VOICE_ENGINE=realtime`, the default),
 * no container runs: the browser talks to the model, and the only server that
 * sees a turn is the web app, when the browser records it at
 * `/api/realtime/agent-turn`. Nothing there traced, so Langfuse went quiet.
 *
 * Same shape as bot.py and the eval harness (`eval/langfuse.ts`), on the v4
 * data model: one trace per agent turn, the turn's overall input (what it
 * answered) and output (what it said) on the ROOT OBSERVATION, the model call
 * as a generation under it, and the drive's `capture_session.id` as the
 * session id, its prompt version as `version`, propagated to every
 * observation so session cost and version filters include the generation.
 *
 * Inert without LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY, and never throws:
 * a Langfuse that is down costs a missing trace, not a turn record.
 *
 * WHAT IS SENT. The agent's words and the words it answered, as the container
 * sent them before. The host decides where participants' words go, so point
 * LANGFUSE_BASE_URL only at an instance cleared for them (see .env.example).
 */

import { langfuseConfig, startLangfuse, traceTurn, type Langfuse, type TraceRecord } from "./eval/langfuse";

export interface RealtimeTurn {
  captureSessionId: string;
  seq: number;
  text: string;
  respondingToText?: string | undefined;
  kind?: string | undefined;
  configVersion?: string | undefined;
  requestedModel?: string | undefined;
  resolvedModel?: string | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  totalLatencyMs?: number | undefined;
  ttftMs?: number | undefined;
  asrMs?: number | undefined;
  startOffsetMs: number;
  endOffsetMs: number;
  bargedIn?: boolean | undefined;
  truncatedAtMs?: number | undefined;
  toolCalls?: readonly { name: string; latencyMs: number; error?: string | undefined }[] | undefined;
  error?: string | undefined;
}

/** The trace name every live speech-to-speech turn is filed under. */
export const REALTIME_TRACE_NAME = "realtime-turn";

/**
 * A recorded turn as a trace. Pure, so it is tested without an exporter.
 *
 * The server sees the turn only once it is over, so its timing is
 * reconstructed: the generation ends now and began `totalLatencyMs` earlier.
 */
export function realtimeTurnRecord(turn: RealtimeTurn, now: Date = new Date()): TraceRecord {
  const latencyMs = Math.max(0, turn.totalLatencyMs ?? 0);
  const startedAt = new Date(now.getTime() - latencyMs);
  const model = turn.resolvedModel || turn.requestedModel || "realtime";
  const input = turn.respondingToText ?? "";
  return {
    name: REALTIME_TRACE_NAME,
    sessionId: turn.captureSessionId,
    tags: ["realtime", turn.kind ?? "reply"],
    version: turn.configVersion ?? "unknown",
    input,
    output: turn.text,
    metadata: {
      seq: turn.seq,
      kind: turn.kind ?? "reply",
      start_offset_ms: turn.startOffsetMs,
      end_offset_ms: turn.endOffsetMs,
      ...(turn.bargedIn !== undefined ? { barged_in: turn.bargedIn } : {}),
      ...(turn.truncatedAtMs !== undefined ? { truncated_at_ms: turn.truncatedAtMs } : {}),
      ...(turn.ttftMs !== undefined ? { ttft_ms: turn.ttftMs } : {}),
      ...(turn.asrMs !== undefined ? { asr_ms: turn.asrMs } : {}),
      ...(turn.toolCalls?.length ? { tool_calls: turn.toolCalls.map((t) => t.name) } : {}),
      ...(turn.error ? { error: turn.error } : {}),
    },
    generations: [
      {
        name: "realtime-reply",
        model,
        input,
        output: turn.text,
        startedAt,
        latencyMs,
        ...(turn.promptTokens !== undefined || turn.completionTokens !== undefined
          ? { usage: { input: turn.promptTokens ?? 0, output: turn.completionTokens ?? 0 } }
          : {}),
      },
    ],
    scores: [],
    startedAt,
  };
}

// One exporter per server process, started on the first traced turn.
// `undefined` until then; `null` once found unconfigured.
let live: Langfuse | null | undefined;

/** The process's exporter, or null when Langfuse is not configured. */
export function liveLangfuse(env: NodeJS.ProcessEnv = process.env): Langfuse | null {
  if (live === undefined) {
    const config = langfuseConfig(env);
    live = config ? startLangfuse(config) : null;
  }
  return live;
}

/**
 * Trace one recorded turn. Returns the trace id, or null when Langfuse is off
 * or the export could not be set up. Spans are batched by the processor and
 * leave in the background; the web app is a long-running server, so nothing
 * here waits for them.
 */
export function traceRealtimeTurn(turn: RealtimeTurn): string | null {
  try {
    const langfuse = liveLangfuse();
    if (!langfuse) return null;
    return traceTurn(langfuse, realtimeTurnRecord(turn)) || null;
  } catch {
    return null;
  }
}

/** For tests: forget the process's exporter. */
export function resetLiveLangfuse(): void {
  live = undefined;
}
