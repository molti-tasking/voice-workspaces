/**
 * The task board's one piece of per-user state: whether it is switched on.
 *
 * The board itself is folded from the op log (`foldBoard` in
 * @voicemural/workspace); nothing about its contents lives here. What does is
 * the study's before/after phase — `user.board_enabled_at` — which has no admin
 * UI on purpose. Participants are enabled one at a time via `pnpm db:studio` or
 * `UPDATE "user" SET board_enabled_at = now() WHERE id = …`.
 */
import { user, workspaceOp } from "./schema";
import { eq, getDb, sql } from "./index";

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

/**
 * A fingerprint of the op log the board is folded from.
 *
 * What `/api/board/stream` compares every tick, so an open board costs one
 * indexed aggregate every couple of seconds rather than a fold. The newest seq
 * moves on every write — a drag, the agent's tool call, an extraction — and the
 * count moves on the one change that can leave the newest seq where it was:
 * ops deleted from the log.
 *
 * The page computes the same string from the ops it rendered
 * (`boardVersionOf`), so the browser can tell "changed since I was drawn" from
 * "changed since I last looked" without asking twice.
 */
export async function boardVersion(userId: string): Promise<string> {
  const [row] = await getDb()
    .select({
      seq: sql<string | null>`max(${workspaceOp.seq})`,
      n: sql<number>`count(*)::int`,
    })
    .from(workspaceOp)
    .where(eq(workspaceOp.userId, userId));
  return boardVersionOf(Number(row?.seq ?? 0), row?.n ?? 0);
}

/** The same fingerprint, from ops already loaded. See `boardVersion`. */
export function boardVersionOf(newestSeq: number, count: number): string {
  return `${newestSeq}:${count}`;
}
