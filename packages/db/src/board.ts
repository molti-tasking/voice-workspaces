/**
 * The task board's one piece of per-user state: whether it is switched on.
 *
 * The board itself is folded from the op log (`foldBoard` in
 * @voicemural/workspace); nothing about its contents lives here. What does is
 * the study's before/after phase — `user.board_enabled_at` — which has no admin
 * UI on purpose. Participants are enabled one at a time via `pnpm db:studio` or
 * `UPDATE "user" SET board_enabled_at = now() WHERE id = …`.
 */
import { eq, getDb } from "./index";
import { user } from "./schema";

/** When the board was enabled for this user, or null while it is hidden. */
export async function boardEnabledAt(userId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ at: user.boardEnabledAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.at ?? null;
}

/** Switch the board on. Idempotent: an already-enabled user keeps their date. */
export async function enableBoard(userId: string, at: Date = new Date()): Promise<void> {
  const existing = await boardEnabledAt(userId);
  if (existing) return;
  await getDb().update(user).set({ boardEnabledAt: at }).where(eq(user.id, userId));
}
