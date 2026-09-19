import { NextResponse } from "next/server";
import { z } from "zod";
import { and, captureSession, eq, getDb, isNull } from "@voicemural/db";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Close a capture session.
 *
 * Best-effort: a drive usually ends by arriving somewhere, not by deciding to
 * stop, so this call is often never made. The worker's sweep closes sessions
 * that have gone quiet, and `on-session-end-summarise` fires from there. Never
 * make correctness depend on this endpoint being reached.
 *
 * `debriefEndedOffsetMs` closes the readable window when the participant taps
 * Done on the three questions (see `/debrief`). Optional, because every other
 * way a session ends — the idle sweep, a dead zone, a phone put down — leaves
 * it null, and a debrief with no end is read as running to the end of the
 * recording. That is the reading that keeps the promise: it can only make the
 * readable window smaller than the truth, never larger.
 */

const Body = z.object({
  debriefEndedOffsetMs: z.number().int().min(0).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  // A body is optional here and always has been: the recorder's own teardown
  // paths post nothing at all, and so does `dismissResumable`.
  const body = Body.safeParse(await req.json().catch(() => null));
  const { id } = await params;

  const updated = await getDb()
    .update(captureSession)
    .set({
      endedAt: new Date(),
      endedBy: "client",
      ...(body.success && body.data.debriefEndedOffsetMs !== undefined
        ? { debriefEndedOffsetMs: body.data.debriefEndedOffsetMs }
        : {}),
    })
    .where(
      and(
        eq(captureSession.id, id),
        eq(captureSession.userId, userId),
        // Do not move endedAt if the sweep already closed it.
        isNull(captureSession.endedAt),
      ),
    )
    .returning({ id: captureSession.id });

  // No analytics event here on purpose. This request comes from a phone that
  // may be on a poor connection at the end of a drive, and the session is not
  // finished in any meaningful sense until its queued chunks have drained and
  // been transcribed. The worker emits `capture_session_completed` once that
  // has actually settled; `endedBy` above is what tells it this path was taken.
  return NextResponse.json({ id, closed: updated.length > 0 });
}
