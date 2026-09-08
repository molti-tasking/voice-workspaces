import { NextResponse } from "next/server";
import { boardEnabledAt } from "@voicemural/db/board";
import { appendUserOp, loadOps } from "@voicemural/db/workspace";
import { TaskState, foldWorkspace, headOf, rootOf, transitionsOf } from "@voicemural/workspace";
import { capture, sessionIdFrom } from "@/lib/analytics/server";
import { currentUserId } from "@/lib/session";
import { z } from "zod";

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
  const ops = await loadOps(userId);
  const state = foldWorkspace(ops);

  const block = state.allBlocks.get(blockId);
  if (!block) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // The page may be showing a block that speech has since revised. The gesture
  // was aimed at the card, so it lands on whatever block the card now is.
  const head = headOf(state.allBlocks, blockId) ?? block;
  if (head.kind !== "task" || head.retiredAt) {
    return NextResponse.json({ error: "not_a_task" }, { status: 409 });
  }

  const cardId = rootOf(state.allBlocks, head.id);
  const history = transitionsOf(ops).filter((t) => t.cardId === cardId);
  const last = history[history.length - 1];
  const previousVia = last ? last.via : null;
  const currentState = head.state ?? "open";
  const body = parsed.data;

  if (body.action === "retire") {
    await appendUserOp({
      userId,
      id: body.opId,
      op: { type: "retire_block", blockId: head.id, via: "user" },
    });

    capture(
      userId,
      "board_card_retired",
      { block_id: head.id, card_id: cardId, state: currentState, previous_via: previousVia },
      { sessionId: sessionIdFrom(req) },
    );
    return NextResponse.json({ status: "ok", retired: true });
  }

  // Moving a card to the column it is already in is not a transition, and
  // recording one would put a phantom "kept" in the measurement.
  if (currentState === body.state) {
    return NextResponse.json({ status: "unchanged", blockId: head.id, state: currentState });
  }

  await appendUserOp({
    userId,
    id: body.opId,
    op: {
      type: "revise_block",
      // The op id doubles as the new block id: one key, idempotent for both.
      blockId: body.opId,
      supersedesBlockId: head.id,
      topicId: head.topicId,
      kind: "task",
      text: head.text,
      spans: head.spans,
      state: body.state,
      via: "user",
    },
  });

  capture(
    userId,
    "board_card_moved",
    {
      block_id: body.opId,
      card_id: cardId,
      from_state: currentState,
      to_state: body.state,
      previous_via: previousVia,
      // Putting the card back where speech had moved it from is the reversal
      // the study is built to count.
      reverses_speech: last?.via === "speech" && last.from === body.state,
      sessions_since_last_transition: last ? sessionsSince(ops, last.seq, last.captureSessionId) : 0,
    },
    { sessionId: sessionIdFrom(req) },
  );

  return NextResponse.json({ status: "ok", blockId: body.opId, state: body.state });
}

/** Distinct drives recorded after an op, not counting the one it came from. */
function sessionsSince(
  ops: readonly { seq: number; captureSessionId?: string }[],
  seq: number,
  own: string | undefined,
): number {
  const later = new Set<string>();
  for (const op of ops) {
    if (op.seq > seq && op.captureSessionId && op.captureSessionId !== own) {
      later.add(op.captureSessionId);
    }
  }
  return later.size;
}
