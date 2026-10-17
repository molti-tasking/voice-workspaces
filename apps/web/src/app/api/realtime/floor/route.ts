import { NextResponse } from "next/server";
import { z } from "zod";
import { floorEventKindEnum } from "@voicemural/db";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { recordFloorEvent } from "@voicemural/talkback";
import { resolveLiveSession } from "@/lib/talkback/live-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Record a change of who may talk — Lock, Normal, or a Poke — as the container
 * applied it.
 *
 * Posted by the container rather than the browser, because the row is meant to
 * say what was IN FORCE: the lock the agent obeyed, not the tap that asked for
 * it. See `floor_event` in the schema.
 *
 * Carries no text. An enum, an offset and a sequence number, so nothing posted
 * here can cross the study's privacy boundary however it is exported.
 *
 * Ticket-authorised, ownership re-resolved and refused once the drive has
 * ended, exactly as `/decision` is.
 */

const Body = z.object({
  ticket: z.string().min(1),
  seq: z.number().int().min(0),
  offsetMs: z.number().int().min(0),
  kind: z.enum(floorEventKindEnum.enumValues),
  // The floor a connection started with, which nobody pressed for.
  atConnect: z.boolean().optional(),
  configVersion: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { ticket, ...event } = parsed.data;

  let payload;
  try {
    payload = verifyTicket(ticket);
  } catch {
    return NextResponse.json({ error: "bad_ticket" }, { status: 401 });
  }

  const session = await resolveLiveSession("floor", payload.captureSessionId, payload.userId);
  if (!session.live) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  await recordFloorEvent({
    ...event,
    captureSessionId: payload.captureSessionId,
    userId: payload.userId,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
