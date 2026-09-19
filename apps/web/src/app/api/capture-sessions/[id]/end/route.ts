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
 * SINCE THE DEBRIEF, this is the second half of Stop rather than the whole of
 * it: Stop opens the debrief window (`../debrief`) and keeps recording, and
 * this closes both the window and the drive when the person taps done. A drive
 * that never gets here is closed by the sweep with no debrief offsets, which
 * is the honest record of a debrief that did not happen.
 */

const Body = z.object({
  /** Ms into the drive when the debrief ended. Absent when there was none. */
  debriefEndedOffsetMs: z.number().int().min(0).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const { id } = await params;

  /* Where the debrief window closes, when there was one.
   *
   * Optional, and absent from every caller that is not the recorder's done
   * button: `dismissResumable` closes out a drive nobody debriefed, and the
   * sweep never calls this route at all. A body that is not JSON — which is
   * what a bare `fetch(url, {method:"POST"})` sends — reads as "no debrief",
   * which is exactly what it means. */
  const body = Body.safeParse(await req.json().catch(() => null));
  const debriefEndedOffsetMs = body.success ? body.data.debriefEndedOffsetMs : undefined;

  const updated = await getDb()
    .update(captureSession)
    .set({
      endedAt: new Date(),
      endedBy: "client",
      ...(debriefEndedOffsetMs === undefined ? {} : { debriefEndedOffsetMs }),
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
