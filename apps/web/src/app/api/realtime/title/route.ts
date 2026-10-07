import { NextResponse } from "next/server";
import { z } from "zod";
import { setSessionTitle } from "@voicemural/db/sessions";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { resolveLiveSession } from "@/lib/talkback/live-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Keep the drive's live topic title, so the drive has a name afterwards.
 *
 * The voice container names what is being talked about every half minute or
 * so (`TopicTitle` in bot.py) and pushes it to the screen; until now it went
 * nowhere else, and every list of past drives was a column of dates — "the
 * tool does not allow me to view my past transcripts easily" (7 Oct 2026).
 * Each new title replaces the last, so the drive ends up named by what it had
 * arrived at.
 *
 * Ticket-authorised like the container's other routes, and refused once the
 * drive has ended (`resolveLiveSession`): a title computed after Stop names
 * nothing the person said in the drive.
 */
const Body = z.object({
  ticket: z.string().min(1),
  title: z.string().min(1).max(400),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyTicket(parsed.data.ticket);
  } catch {
    return NextResponse.json({ error: "bad_ticket" }, { status: 401 });
  }

  const session = await resolveLiveSession("title", payload.captureSessionId, payload.userId);
  if (!session.live) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const saved = await setSessionTitle(payload.captureSessionId, parsed.data.title);
  return NextResponse.json({ ok: true, saved }, { headers: { "Cache-Control": "no-store" } });
}
