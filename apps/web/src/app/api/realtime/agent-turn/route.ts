import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { recordAgentTurn } from "@voicemural/talkback";
import { resolveLiveSession } from "@/lib/talkback/live-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record what the agent said, so that later it can tell that it said it.
 *
 * NOT bookkeeping. `agent_turn` is what the echo filter reads: the agent's
 * voice reaches the microphone through the speaker, gets transcribed into
 * `utterance` like any other sound, and without a record of what was spoken
 * there is no way to tell those lines apart from the driver's own. The system
 * then quotes its own last reply back as something the driver said and proceeds
 * to have a conversation with itself.
 *
 * That is not hypothetical. With nothing writing this table, recall returned
 * "[yesterday] Yes, I can hear you." — the agent's own words, presented to it
 * as the participant's.
 *
 * It is also the paper's turn-taking data: `bargedIn`, `truncatedAtMs` and the
 * latency columns are the record of a conversation that cannot be replayed.
 *
 * Ticket-authorised for the same reason as the context route — the Python
 * container has no session — and ownership is re-resolved rather than trusted.
 * So is whether the drive is still running: a turn written after Stop belongs
 * to no conversation and skews every count taken from the session. See
 * `resolveLiveSession`.
 */

/**
 * Caps, for the same reason the draft route has them: this is model output
 * written straight to a column. Kept far above any real turn — spoken replies
 * are word-capped by the setting profiles, and only a runaway generation
 * approaches this — because truncated text would stop matching its own echo
 * in the transcript. A clip at this size is data worth having; a column with
 * no ceiling is a panel that cannot render.
 */
const MAX_TURN_CHARS = 20_000;
const MAX_CONTEXT_CHARS = 2_000;
const MAX_ERROR_CHARS = 1_000;

const Body = z.object({
  ticket: z.string().min(1),
  seq: z.number().int().min(0),
  startOffsetMs: z.number().int().min(0),
  endOffsetMs: z.number().int().min(0),
  text: z.string(),
  generatedText: z.string(),
  respondingToText: z.string().optional(),
  bargedIn: z.boolean().optional(),
  // How far into the turn the person spoke over it, from the container's
  // `InterruptionFrame`. Was missing here while the column existed, so an
  // interrupted turn could never say where it was cut.
  truncatedAtMs: z.number().int().min(0).optional(),
  // What prompted the turn. Accepted by `recordAgentTurn` from the start but
  // never by this route, so every turn — offers included — was stored as a
  // `reply`, and the analysis could not tell an unprompted turn from an answer.
  kind: z.enum(["reply", "proactive_prompt", "confirmation_request", "backchannel"]).optional(),
  // Echoed from `/api/realtime/session` by the container, rather than stamped
  // here from this deployment's constant: a web deploy mid-drive changes the
  // constant, not the prompt the container is already running.
  configVersion: z.string().max(64).optional(),
  // Pipecat's own name for the model it called — the alias, before LiteLLM
  // resolves it. `resolvedModel` stays for a writer that can see the proxy's answer.
  requestedModel: z.string().max(200).optional(),
  resolvedModel: z.string().optional(),
  asrMs: z.number().int().optional(),
  ttftMs: z.number().int().optional(),
  speakTtfbMs: z.number().int().optional(),
  totalLatencyMs: z.number().int().optional(),
  promptTokens: z.number().int().min(0).optional(),
  completionTokens: z.number().int().min(0).optional(),
  // The tools this turn called before it spoke — the board edits the agent
  // made. Names and timings only; what changed is in `workspace_op`.
  toolCalls: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        latencyMs: z.number().int().min(0),
        error: z.string().max(500).optional(),
      }),
    )
    .max(8)
    .optional(),
  error: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { ticket, ...turn } = parsed.data;

  let payload;
  try {
    payload = verifyTicket(ticket);
  } catch {
    return NextResponse.json({ error: "bad_ticket" }, { status: 401 });
  }

  // Ownership AND still-running, together: a row for a session that has ended
  // corrupts every count and duration taken from it. See `resolveLiveSession`.
  const session = await resolveLiveSession("agent-turn", payload.captureSessionId, payload.userId);
  if (!session.live) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const id = await recordAgentTurn({
    ...turn,
    text: turn.text.slice(0, MAX_TURN_CHARS),
    generatedText: turn.generatedText.slice(0, MAX_TURN_CHARS),
    respondingToText: turn.respondingToText?.slice(0, MAX_CONTEXT_CHARS),
    error: turn.error?.slice(0, MAX_ERROR_CHARS),
    captureSessionId: payload.captureSessionId,
    userId: payload.userId,
  });

  // The id goes back so the container can post the turn's decision pointing at
  // it — sequentially, from the same task, which is what keeps that foreign
  // key from racing this insert. Null when nothing was written.
  return NextResponse.json({ ok: true, id }, { headers: { "Cache-Control": "no-store" } });
}
