import { NextResponse } from "next/server";
import { z } from "zod";
import { boardEnabledAt } from "@voicemural/db/board";
import { appendUserOp, loadOps } from "@voicemural/db/workspace";
import {
  MAX_IMPORT_TASKS,
  MAX_TASK_TEXT,
  TaskState,
  planBoardImport,
} from "@voicemural/workspace";
import { capture, sessionIdFrom } from "@/lib/analytics/server";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * A board the person already keeps somewhere else, written as cards.
 *
 * WHAT ARRIVES HERE IS ALREADY A TASK LIST, not a pasted export. The parse
 * happens in the browser (`parseBoard` in @voicemural/workspace, which the
 * import page imports the same way the board imports `TaskState`), so the raw
 * paste — a Jira CSV with its assignees, reporters and comment counts, a Notion
 * page with whatever else was on it — never leaves the device. Only the lines
 * the person confirmed as tasks are sent. That is not politeness; participants
 * were told nobody reads their words, and the smaller the thing crossing the
 * wire the easier that promise is to keep.
 *
 * Ops carry `via: "import"` and no spans. `judge()` does not score them — see
 * the note in `board-import.ts` — and `loadUserOps` keeps them, so a
 * `workspace:rebuild` restores the imported board rather than emptying it.
 *
 * Idempotent on `batchId`: every row id is derived from it and the task's own
 * words, so a submit retried on a flaky connection is a no-op at the primary
 * key rather than a second copy of someone's board.
 */
const Task = z.object({
  text: z.string().min(1).max(MAX_TASK_TEXT),
  state: TaskState,
  topic: z.string().min(1).max(80).optional(),
});

const Body = z.object({
  batchId: z.uuid(),
  tasks: z.array(Task).min(1).max(MAX_IMPORT_TASKS),
  /** Where tasks with no topic of their own should land. */
  topic: z.string().max(80).optional(),
  /** Which reader understood the paste. Reported, never trusted. */
  format: z.enum(["trello-json", "table", "outline"]),
});

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Hidden exactly as the board page is: a participant in the before phase has
  // no board, so there is nothing to import into.
  if (!(await boardEnabledAt(userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { batchId, tasks, topic, format } = parsed.data;
  const ops = await loadOps(userId);
  const plan = planBoardImport(ops, tasks, { batchId, topic });

  if (plan.ops.length === 0) {
    // Everything was already on the board — the second submit of a retry, or a
    // second import of the same export. Not an error, and not a write.
    return NextResponse.json({ status: "ok", imported: 0, skipped: plan.skipped });
  }

  for (const row of plan.ops) {
    await appendUserOp({ userId, id: row.id, op: row.op });
  }

  const duplicates = plan.skipped.filter((s) => s.reason === "duplicate").length;
  capture(
    userId,
    "board_imported",
    {
      format,
      card_count: plan.cards.length,
      topics_created: plan.topicsCreated.length,
      skipped_duplicate: duplicates,
      skipped_other: plan.skipped.length - duplicates,
      columns_used: new Set(plan.cards.map((c) => c.state)).size,
    },
    { sessionId: sessionIdFrom(req) },
  );

  return NextResponse.json({
    status: "ok",
    imported: plan.cards.length,
    topicsCreated: plan.topicsCreated,
    skipped: plan.skipped,
  });
}
