import { NextResponse } from "next/server";
import { z } from "zod";
import { curateDraft } from "@voicemural/db/drafts";
import { appendUserOp, loadOps, withBoardLock } from "@voicemural/db/workspace";
import {
  TaskState,
  foldWorkspace,
  headOf,
  planBoardEdit,
  type WorkspaceOp,
} from "@voicemural/workspace";
import { capture, sessionIdFrom } from "@/lib/analytics/server";
import { applyBoardEdit } from "@/lib/board/apply-edit";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retire_topic"), topicId: z.string().min(1), opId: z.uuid() }),
  z.object({ action: z.literal("restore_topic"), topicId: z.string().min(1), opId: z.uuid() }),
  z.object({ action: z.literal("retire_block"), blockId: z.string().min(1), opId: z.uuid() }),
  z.object({ action: z.literal("restore_block"), blockId: z.string().min(1), opId: z.uuid() }),
  z.object({ action: z.literal("archive_draft"), draftId: z.uuid(), opId: z.uuid() }),
  z.object({ action: z.literal("restore_draft"), draftId: z.uuid(), opId: z.uuid() }),
  z.object({
    action: z.literal("set_state"),
    blockId: z.string().min(1),
    state: TaskState,
    opId: z.uuid(),
  }),
]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The person curating their own workspace: archive or restore a topic or a
 * single item, or move a task — the last so a phone, which has no board, can
 * still say a task is done.
 *
 * WHY THIS EXISTS. The pilots' main complaint was a workspace that only grew:
 * "I can only download it". Every action here is a tombstone op with
 * `via: "user"`, never a delete — the ledger is append-only (EVALUATION_PLAN
 * §4 constraint 3), so undo is one more op and the workspace as it stood is
 * still one `asOf` away.
 *
 * Same lock, same client-minted `opId` as the board's route: an archive can
 * race the agent's own board edits and the extractor, and a retry after a
 * dead zone must be a no-op at the primary key. Ownership is proved by
 * presence — `loadOps` is user-scoped.
 *
 * Not gated on `boardEnabledAt`: the workspace is every participant's.
 */
export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const body = parsed.data;
  const analyticsSessionId = sessionIdFrom(req) ?? undefined;

  // Drafts are not ops: they live in their own append-only tables, so they
  // need neither the fold nor the board lock.
  if (body.action === "archive_draft" || body.action === "restore_draft") {
    const written = await curateDraft({
      id: body.opId,
      draftId: body.draftId,
      userId,
      action: body.action === "archive_draft" ? "archive" : "restore",
    });
    if (written === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (written === "inserted") {
      capture(
        userId,
        "workspace_curated",
        { action: body.action, block_count: 1, age_days: 0 },
        { sessionId: analyticsSessionId },
      );
    }
    return NextResponse.json({ status: written === "inserted" ? "ok" : "unchanged", target: body.draftId });
  }

  const outcome = await withBoardLock(userId, async (db) => {
    const ops = await loadOps(userId, db);

    if (body.action === "set_state") {
      const plan = planBoardEdit(
        ops,
        { action: "move", state: body.state },
        { via: "user", opId: body.opId, target: { blockId: body.blockId } },
      );
      switch (plan.status) {
        case "not_found":
          return { status: 404 as const, body: { error: "not_found" } };
        case "not_a_task":
        case "ambiguous":
        case "invalid":
          return { status: 409 as const, body: { error: "not_a_task" } };
        case "exists":
        case "unchanged":
          return {
            status: 200 as const,
            body: { status: "unchanged", blockId: plan.card.blockId, state: plan.card.state },
          };
      }
      await applyBoardEdit({ userId, ops, plan, by: "user", analyticsSessionId, db });
      return {
        status: 200 as const,
        body: { status: "ok", blockId: plan.card.blockId, state: plan.card.state },
      };
    }

    const state = foldWorkspace(ops);
    const now = Date.now();
    let op: WorkspaceOp;
    let blockKind: string | undefined;
    let blockCount = 1;
    let since: Date;
    // What an undo must aim at — for a block, the one actually retired, which
    // may be a later revision of the one the page showed.
    let target: string;

    switch (body.action) {
      case "retire_topic": {
        const topic = state.topics.find((t) => t.id === body.topicId);
        if (!topic) return unchangedOrMissing(state.archivedTopics.some((t) => t.id === body.topicId));
        op = { type: "retire_topic", topicId: topic.id, via: "user" };
        target = topic.id;
        blockCount = state.blocksByTopic.get(topic.id)?.length ?? 0;
        since = topic.createdAt;
        break;
      }
      case "restore_topic": {
        const topic = state.archivedTopics.find((t) => t.id === body.topicId);
        if (!topic) return unchangedOrMissing(state.topics.some((t) => t.id === body.topicId));
        op = { type: "restore_topic", topicId: topic.id, via: "user" };
        target = topic.id;
        blockCount = state.blocksByTopic.get(topic.id)?.length ?? 0;
        since = topic.createdAt;
        break;
      }
      case "retire_block": {
        // The page may be showing a block speech has since revised; the
        // gesture was aimed at the item, so it lands on what the item now is.
        const block = headOf(state.allBlocks, body.blockId);
        if (!block) return unchangedOrMissing(false);
        if (block.retiredAt) return unchangedOrMissing(true);
        op = { type: "retire_block", blockId: block.id, via: "user" };
        target = block.id;
        blockKind = block.kind;
        since = block.occurredAt;
        break;
      }
      case "restore_block": {
        const block = state.allBlocks.get(body.blockId);
        if (!block || block.supersededById) return unchangedOrMissing(false);
        if (!block.retiredAt) return unchangedOrMissing(true);
        op = { type: "restore_block", blockId: block.id, via: "user" };
        target = block.id;
        blockKind = block.kind;
        since = block.occurredAt;
        break;
      }
    }

    const written = await appendUserOp({ userId, id: body.opId, op, db });
    if (written === "inserted") {
      capture(
        userId,
        "workspace_curated",
        {
          action: body.action,
          block_kind: blockKind,
          block_count: blockCount,
          age_days: Math.max(0, Math.floor((now - since.getTime()) / DAY_MS)),
        },
        { sessionId: analyticsSessionId },
      );
    }
    return {
      status: 200 as const,
      body: { status: written === "inserted" ? "ok" : "unchanged", target },
    };
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}

/** Already in the state asked for is success, not an error: the tap was retried. */
function unchangedOrMissing(alreadyThere: boolean) {
  return alreadyThere
    ? { status: 200 as const, body: { status: "unchanged" } }
    : { status: 404 as const, body: { error: "not_found" } };
}
