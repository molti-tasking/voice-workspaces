import { NextResponse } from "next/server";
import { z } from "zod";
import { agentDecisionOutcomeEnum, agentDecisionTriggerEnum } from "@voicemural/db";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { recordAgentDecision } from "@voicemural/talkback";
import { resolveLiveSession } from "@/lib/talkback/live-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record what the model did with a moment it was given to speak — including
 * when it chose not to.
 *
 * The sibling of `/agent-turn`, and deliberately not the same route. A turn is
 * audio that reached a speaker and feeds the echo filter; a decision is the
 * choice behind it, and most of the interesting ones produced no audio at all:
 * the silence the agent kept, the offer it passed up, the reply the driver
 * talked over before a word came out. See `agent_decision` in the schema.
 *
 * Carries no text of any kind. Counts, timings, enums and ids only, so nothing
 * posted here can cross the study's privacy boundary however it is exported.
 * `subjectKey` is an id (an invocation, a proposal, a topic), never a phrase.
 *
 * Ticket-authorised, ownership re-resolved and refused once the drive has
 * ended, exactly as `/agent-turn` is.
 */

const Body = z.object({
  ticket: z.string().min(1),
  seq: z.number().int().min(0),
  offsetMs: z.number().int().min(0),
  trigger: z.enum(agentDecisionTriggerEnum.enumValues),
  outcome: z.enum(agentDecisionOutcomeEnum.enumValues),
  configVersion: z.string().max(64).optional(),
  latencyMs: z.number().int().min(0).optional(),
  // An id, so bounded like one. Anything longer is not a key.
  subjectKey: z.string().min(1).max(128).optional(),
  agentTurnId: z.uuid().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { ticket, ...decision } = parsed.data;

  let payload;
  try {
    payload = verifyTicket(ticket);
  } catch {
    return NextResponse.json({ error: "bad_ticket" }, { status: 401 });
  }

  // Ownership AND still-running, together: a row for a session that has ended
  // corrupts every count and duration taken from it. See `resolveLiveSession`.
  const session = await resolveLiveSession("decision", payload.captureSessionId, payload.userId);
  if (!session.live) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  await recordAgentDecision({
    ...decision,
    captureSessionId: payload.captureSessionId,
    userId: payload.userId,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
