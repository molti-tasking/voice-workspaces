import { NextResponse } from "next/server";
import { captureSession, eq, getDb, studyItemReview } from "@voicemural/db";
import { StudyItemReviewCreate } from "@voicemural/shared";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * The day-7 verdict on one board item: done, still open, or lost.
 *
 * `lost` IS THE POINT. It is the primary failure measure for offloading, and
 * it is defined behaviourally — never revisited, not acted on — rather than by
 * how anyone feels about it. A system that writes many items to the board and
 * never brings them back has failed however good its latency looks, and
 * nothing else in the schema can say so: `workspace_op` records that an item
 * was written, `judge()` records whether a machine-made move survived, and
 * neither answers "did this ever come back to you".
 *
 * ONE VERDICT PER CARD, corrected in place. The review reads each item back
 * and the person answers; a correction replaces the answer rather than adding
 * a second one, which is what the unique index on (user, card) enforces.
 *
 * Counts only, like everything else under `/api/study`: an id, one of three
 * words, and a timestamp.
 */

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = StudyItemReviewCreate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { cardId, captureSessionId, outcome } = parsed.data;

  // The review may be recorded inside a drive — the day-7 session is a
  // recording like any other — so the drive is re-resolved, never trusted.
  if (captureSessionId) {
    const rows = await getDb()
      .select({ userId: captureSession.userId })
      .from(captureSession)
      .where(eq(captureSession.id, captureSessionId))
      .limit(1);
    if (rows[0]?.userId !== userId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  await getDb()
    .insert(studyItemReview)
    .values({ userId, cardId, captureSessionId: captureSessionId ?? null, outcome })
    .onConflictDoUpdate({
      target: [studyItemReview.userId, studyItemReview.cardId],
      set: { outcome, captureSessionId: captureSessionId ?? null, reviewedAt: new Date() },
    });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
