import { NextResponse } from "next/server";
import { z } from "zod";
import { recordSubjectVisit } from "@voicemural/db/subjects";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { resolveLiveSession } from "@/lib/talkback/live-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Keep the drive's subjects, and when the talk was on each.
 *
 * The voice container names the subject being talked about (`TopicTitle` in
 * bot.py) and numbers it in the order it first came up. Until now that lived
 * only on the screen, and a reload lost it. Here it becomes a `drive_subject`
 * and a `drive_subject_segment` per visit — which is what the sparks key on
 * (`s{ordinal}`) and what the recall probe needs, days later, to show the
 * person their own words on one subject.
 *
 * Posted when the talk turns to a subject (an open visit) and when it turns
 * away (the same visit, closed). The title is CONTENT, like `/title`'s: kept
 * on the subject, never exported, never logged.
 *
 * Ticket-authorised and refused once the drive has ended, like the
 * container's other writes. The last visit is therefore never closed here —
 * Stop ends the session first — and a reader closes it at the drive's end.
 */
const Body = z.object({
  ticket: z.string().min(1),
  ordinal: z.number().int().min(1).max(10_000),
  title: z.string().min(1).max(400),
  startOffsetMs: z.number().int().min(0),
  endOffsetMs: z.number().int().min(0).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { ticket, ...visit } = parsed.data;
  if (visit.endOffsetMs !== undefined && visit.endOffsetMs < visit.startOffsetMs) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyTicket(ticket);
  } catch {
    return NextResponse.json({ error: "bad_ticket" }, { status: 401 });
  }

  const session = await resolveLiveSession("subject", payload.captureSessionId, payload.userId);
  if (!session.live) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  try {
    await recordSubjectVisit({ ...visit, captureSessionId: payload.captureSessionId });
  } catch (err) {
    // The ordinal, never the title: titles stay out of every log line.
    console.error(
      `[realtime] could not record subject s${visit.ordinal} for ${payload.captureSessionId}:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "not_recorded" }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
