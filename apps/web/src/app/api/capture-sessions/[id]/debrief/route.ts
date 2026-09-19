import { NextResponse } from "next/server";
import { z } from "zod";
import { and, captureSession, eq, getDb, isNull } from "@voicemural/db";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Open the debrief window: Stop, without ending the recording.
 *
 * WHAT WAS WRONG. `/study` promises participants three questions after every
 * drive, and tells them researchers read those answers — they are the one part
 * of the corpus that is content by design. Stop ended the session, so the
 * questions were asked with the microphone already closed and the answers were
 * never recorded at all. Pilot 01 has a debrief that exists only in the
 * researcher's memory.
 *
 * WHAT HAPPENS NOW. Stop calls this instead of `/end`. Capture keeps running,
 * talk-back disconnects (the agent must not join a debrief, and a turn arriving
 * during it is refused — see `authoriseOpenDrive`), and the recorder shows the
 * three questions. Tapping done calls `/end`, which stamps the other side of
 * the window. The utterances between the two offsets are the debrief.
 *
 * A DRIVE MAY HAVE NO DEBRIEF. The idle sweep closes sessions that go quiet,
 * and a drive that ends by arriving somewhere often never reaches this call.
 * Null then means "no debrief was recorded", which is a different fact from an
 * empty one and worth keeping apart.
 *
 * IDEMPOTENT: a double tap, or a retry from a phone on a bad connection, must
 * not move the start of a window that is already open.
 */

const Body = z.object({
  /**
   * Where in the recording Stop was tapped, ms from `startedAt`.
   *
   * From the client, because the client is what knows how much audio it has
   * actually recorded — the same number the chunk uploader stamps its offsets
   * with. Deriving it here from `now() - startedAt` would count the minutes a
   * drive spent queued in a dead zone as recorded speech.
   */
  offsetMs: z.number().int().min(0),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { id } = await params;

  const updated = await getDb()
    .update(captureSession)
    .set({ debriefStartedOffsetMs: parsed.data.offsetMs })
    .where(
      and(
        eq(captureSession.id, id),
        eq(captureSession.userId, userId),
        // Never on a drive the sweep has already closed, and never twice.
        isNull(captureSession.endedAt),
        isNull(captureSession.debriefStartedOffsetMs),
      ),
    )
    .returning({ id: captureSession.id });

  return NextResponse.json({ id, opened: updated.length > 0 });
}
