import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb, ratingOutcomeEnum } from "@voicemural/db";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import { MAX_RATING, MIN_RATING, recordInteractionRating } from "@voicemural/talkback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the driver said about the system when they asked to say it.
 *
 * The third of the container's write-backs, alongside `/agent-turn` and
 * `/decision`, and separate from both for the same reason they are separate
 * from each other: a rating is not audio that reached a speaker, and it is not
 * a choice the model made — it is the one thing in the drive that the model
 * was deliberately kept out of. See `RatingProbe` in apps/pipecat/bot.py and
 * the `interaction_rating` table.
 *
 * Carries no text. A number, four enum values, three offsets and an id — so
 * the export needs no redaction and a leaked row leaks nothing that was said.
 * What the driver actually SAID to the probe is never sent here; only what it
 * came to.
 *
 * A probe that produced no number still posts. `unclear` and `timeout` are the
 * evidence that the channel did not work, and a table of successful ratings
 * only would make a broken one look healthy.
 *
 * Ticket-authorised, ownership re-resolved, exactly as its two siblings are.
 */

const Body = z.object({
  ticket: z.string().min(1),
  seq: z.number().int().min(0),
  askedOffsetMs: z.number().int().min(0),
  endedOffsetMs: z.number().int().min(0),
  answeredOffsetMs: z.number().int().min(0).optional(),
  rating: z.number().int().min(MIN_RATING).max(MAX_RATING).optional(),
  outcome: z.enum(ratingOutcomeEnum.enumValues),
  agentTurnId: z.uuid().optional(),
  configVersion: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { ticket, ...rating } = parsed.data;

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

  const id = await recordInteractionRating({
    ...rating,
    captureSessionId: payload.captureSessionId,
    userId: payload.userId,
  });

  return NextResponse.json({ ok: true, id }, { headers: { "Cache-Control": "no-store" } });
}
