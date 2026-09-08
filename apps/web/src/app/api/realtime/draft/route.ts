import { NextResponse } from "next/server";
import { captureSession, eq, getDb } from "@voicemural/db";
import { recordDraft } from "@voicemural/db/drafts";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store a draft the agent produced for the person to keep.
 *
 * The third thing the container writes, after `agent_turn` and nothing else,
 * and it is deliberately NOT that route: a draft was never spoken, so it has no
 * spoken/generated split, no barge-in and no latency — and above all the echo
 * filter must never see it. `withoutEcho` deletes transcript lines that match
 * what the agent said aloud; a draft that only ever existed on screen cannot
 * have been echoed, and filing it as a turn would teach the filter to delete
 * the participant's own words whenever they resembled a draft they asked for.
 *
 * Ticket-authorised like the other two container routes — the Python side has
 * no Better Auth session — and ownership is re-resolved against
 * `capture_session.userId` rather than trusted from the payload.
 */

/**
 * A cap, because this is model output written straight to a column.
 *
 * Generous enough for a long email or a page of notes, and far below anything
 * that would make the cue panel unrenderable on a phone. A model that runs away
 * gets truncated rather than rejected: a clipped draft is still worth having,
 * and losing it entirely to a length check is the worse failure.
 */
const MAX_DRAFT_CHARS = 8_000;
const MAX_TITLE_CHARS = 120;

const Body = z.object({
  ticket: z.string().min(1),
  seq: z.number().int().min(0),
  startOffsetMs: z.number().int().min(0),
  title: z.string().default(""),
  text: z.string().min(1),
  respondingToText: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { ticket, seq, startOffsetMs, title, text, respondingToText } = parsed.data;

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

  await recordDraft({
    captureSessionId: payload.captureSessionId,
    seq,
    startOffsetMs,
    title: title.slice(0, MAX_TITLE_CHARS),
    text: text.slice(0, MAX_DRAFT_CHARS),
    respondingToText,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
