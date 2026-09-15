import { NextResponse } from "next/server";
import { z } from "zod";
import { boardEnabledAt } from "@voicemural/db/board";
import { loadOps } from "@voicemural/db/workspace";
import { TaskState, planBoardEdit } from "@voicemural/workspace";
import { sessionIdFrom } from "@/lib/analytics/server";
import { applyBoardEdit } from "@/lib/board/apply-edit";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_state"), state: TaskState, opId: z.uuid() }),
  z.object({ action: z.literal("retire"), opId: z.uuid() }),
]);

/**
 * A manual gesture on the board: move a card, or say it was not a task.
 *
 * Both are ops in the same ledger the extractor writes to, told apart by
 * `via: "user"`. A move is a `revise_block` that keeps the text and the spans
 * — the card keeps its speech provenance — and changes only the state. That is
 * what makes the person's correction and the model's reading comparable: the
 * evaluation reads keep/reverse straight off the op log.
 *
 * The ops are planned by `planBoardEdit`, the same planner the agent's tool
 * calls go through (/api/realtime/board), so a drag and a spoken "drop it"
 * write the same row apart from `via`.
 *
 * The client mints `opId` and it becomes the row's primary key, so a POST
 * retried after a dead zone is a no-op at the database rather than a second
 * transition. Ownership is proved by presence: `loadOps` is user-scoped, so a
 * block id that is not in this person's fold is simply not found.
 */
export async function POST(req: Request, { params }: { params: Promise<{ blockId: string }> }) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!(await boardEnabledAt(userId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { blockId } = await params;
  const body = parsed.data;
  const ops = await loadOps(userId);

  // The page may be showing a block that speech has since revised. The gesture
  // was aimed at the card, so the planner lands it on whatever block the card
  // now is.
  const plan = planBoardEdit(
    ops,
    body.action === "retire" ? { action: "retire" } : { action: "move", state: body.state },
    { via: "user", opId: body.opId, target: { blockId } },
  );

  switch (plan.status) {
    case "not_found":
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    case "not_a_task":
    case "ambiguous":
    case "invalid":
      return NextResponse.json({ error: "not_a_task" }, { status: 409 });
    case "exists":
    case "unchanged":
      // Moving a card to the column it is already in is not a transition, and
      // recording one would put a phantom "kept" in the measurement.
      return NextResponse.json({ status: "unchanged", blockId: plan.card.blockId, state: plan.card.state });
  }

  await applyBoardEdit({ userId, ops, plan, by: "user", analyticsSessionId: sessionIdFrom(req) ?? undefined });

  return body.action === "retire"
    ? NextResponse.json({ status: "ok", retired: true })
    : NextResponse.json({ status: "ok", blockId: plan.card.blockId, state: plan.card.state });
}
