import { NextResponse } from "next/server";
import { captureSession, eq, getDb } from "@voicemural/db";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { recordAgentTurn } from "@voicemural/talkback";
import { z } from "zod";

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
 */

const Body = z.object({
  ticket: z.string().min(1),
  seq: z.number().int().min(0),
  startOffsetMs: z.number().int().min(0),
  endOffsetMs: z.number().int().min(0),
  text: z.string(),
  generatedText: z.string(),
  respondingToText: z.string().optional(),
  bargedIn: z.boolean().optional(),
  resolvedModel: z.string().optional(),
  asrMs: z.number().int().optional(),
  ttftMs: z.number().int().optional(),
  speakTtfbMs: z.number().int().optional(),
  totalLatencyMs: z.number().int().optional(),
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

  const rows = await getDb()
    .select({ userId: captureSession.userId })
    .from(captureSession)
    .where(eq(captureSession.id, payload.captureSessionId))
    .limit(1);

  if (rows[0]?.userId !== payload.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await recordAgentTurn({
    ...turn,
    captureSessionId: payload.captureSessionId,
    userId: payload.userId,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
