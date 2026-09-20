import { eq, getDb, studyItemReview } from "@voicemural/db";
import { loadOps } from "@voicemural/db/workspace";
import { foldBoard, type TaskState } from "@voicemural/workspace";

/**
 * The day-7 review: what became of each thing they handed the system.
 *
 * WHY IT IS A SEPARATE PASS AT ALL. The board already knows what state a card
 * is in, and that is not the question. A card sitting in `done` says the
 * column was changed; it does not say the work happened. A card sitting in
 * `open` after a week is either still live or quietly abandoned, and those are
 * opposite outcomes for an offloading claim. Only the person can say which,
 * and the point of asking on day 7 is to ask while they can still remember.
 *
 * THREE ANSWERS, and the third is the one the study exists for:
 *
 *   done  — it happened.
 *   open  — still live, they mean to get to it.
 *   lost  — never revisited, never acted on. A thing they said out loud, that
 *           the system wrote down, and that then disappeared for both of them.
 *
 * `lostRate` is the primary failure measure for offloading (`metrics.ts`). A
 * system that writes many items to the board and never brings them back has
 * failed, and no amount of latency or throughput redeems that.
 *
 * DROPPED CARDS ARE NOT IN THE DENOMINATOR. Moving something to `dropped` is
 * a decision the person made about it, which is the opposite of losing it.
 * Neither are cards the participant imported: those were already kept
 * somewhere else before the system saw them, the same exclusion `judge()`
 * makes for the acceptance measure.
 */

export interface PendingItem {
  cardId: string;
  state: TaskState;
  lastTouchedAt: Date;
}

/** Cards still without a verdict, oldest first — the order to read them back in. */
export async function pendingReview(userId: string): Promise<PendingItem[]> {
  const board = foldBoard(await loadOps(userId));
  const decided = new Set(
    (
      await getDb()
        .select({ cardId: studyItemReview.cardId })
        .from(studyItemReview)
        .where(eq(studyItemReview.userId, userId))
    ).map((r) => r.cardId),
  );

  return board.cards
    .filter((card) => card.state !== "dropped")
    .filter((card) => card.lastTransition.via !== "import")
    .filter((card) => !decided.has(card.cardId))
    .map((card) => ({
      cardId: card.cardId,
      state: card.state,
      lastTouchedAt: card.lastTransition.at,
    }))
    .sort((a, b) => a.lastTouchedAt.getTime() - b.lastTouchedAt.getTime());
}

/** Record one verdict. A second answer for the same card corrects the first. */
export async function recordReview(
  userId: string,
  cardId: string,
  outcome: "done" | "open" | "lost",
  captureSessionId?: string,
): Promise<void> {
  await getDb()
    .insert(studyItemReview)
    .values({ userId, cardId, outcome, captureSessionId: captureSessionId ?? null })
    .onConflictDoUpdate({
      target: [studyItemReview.userId, studyItemReview.cardId],
      set: { outcome, reviewedAt: new Date() },
    });
}
