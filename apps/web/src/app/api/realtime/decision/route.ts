import { NextResponse } from "next/server";
import { z } from "zod";
import { agentDecisionOutcomeEnum, agentDecisionTriggerEnum } from "@voicemural/db";
import { recordAgentDecision } from "@voicemural/talkback";
import { authoriseOpenDrive } from "@/lib/realtime/drive";

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
 * Ticket-authorised, ownership re-resolved, exactly as `/agent-turn` is.
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
  // Which MOMENT this decides. Two completions run for one moment arrive with
  // the same `offsetMs` and the same value here, which is what lets the writer
  // keep exactly one of them authoritative instead of double-counting the
  // moment. An opaque id from the container, never a phrase.
  cueId: z.string().min(1).max(64).optional(),
  agentTurnId: z.uuid().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { ticket, ...decision } = parsed.data;

  // Refused once the drive is over, exactly as a turn is. A decision recorded
  // after Stop is a moment nobody was there for, and it would land in every
  // rate the analysis computes over decisions — silent opportunities most of
  // all, which is the measure this table exists for.
  const auth = await authoriseOpenDrive(ticket);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  await recordAgentDecision({
    ...decision,
    captureSessionId: auth.captureSessionId,
    userId: auth.userId,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
