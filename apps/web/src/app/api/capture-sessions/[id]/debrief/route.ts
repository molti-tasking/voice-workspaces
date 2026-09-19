import { NextResponse } from "next/server";
import { z } from "zod";
import { and, captureSession, eq, getDb, isNull } from "@voicemural/db";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Mark where the post-drive debrief starts, while the recording continues.
 *
 * WHAT IT IS FOR. `/study` promises that nobody on the research team listens to
 * a drive or reads its transcript — what researchers see is counts and
 * timings. The debrief is the stated exception: three questions the
 * participant answers aloud, knowing the answers are read. That makes the
 * content channel a property of an INTERVAL inside a recording rather than of
 * the recording, and this is the call that names where the interval begins.
 *
 * WHY IT IS NOT `/end` WITH A FLAG. Because the recording does not end here.
 * The whole point is that the microphone stays open across the seam: the first
 * pilot's most useful material — the accent observation, the request for a
 * filler phrase while a search runs, "ist jetzt die App ausgegangen?" — all
 * happened after `ended_at`, and survives only because somebody happened to be
 * filming. `/end` is still the call that closes the session, and it carries
 * the debrief's end offset when the participant taps Done.
 *
 * Best-effort like `/end`, and for the same reason: a phone at the end of a
 * drive may be on a poor connection. A debrief whose start never reached the
 * server is a debrief nothing may read, which is the safe direction to fail in.
 *
 * WRITE-ONCE. A second call cannot move the start — a participant who taps
 * Stop twice must not be able to shrink the window after the fact, and nothing
 * outside this interval is readable, so moving it can only ever expose more.
 */

const Body = z.object({
  /** Where the debrief begins, in ms into the recording, from the chunk clock. */
  startedOffsetMs: z.number().int().min(0),
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
    .set({ debriefStartedOffsetMs: parsed.data.startedOffsetMs })
    .where(
      and(
        eq(captureSession.id, id),
        eq(captureSession.userId, userId),
        // Not into a session that is already closed, and not a second time.
        isNull(captureSession.endedAt),
        isNull(captureSession.debriefStartedOffsetMs),
      ),
    )
    .returning({ id: captureSession.id });

  return NextResponse.json({ id, marked: updated.length > 0 });
}
