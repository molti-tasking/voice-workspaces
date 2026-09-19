import type { Executor } from "@voicemural/db";
import { appendUserOp } from "@voicemural/db/workspace";
import type { PlannedEdit, StoredOp } from "@voicemural/workspace";
import { capture } from "@/lib/analytics/server";

type Applied = Extract<PlannedEdit, { status: "apply" }>;

/**
 * Write a planned board edit and report it.
 *
 * The one place a board edit reaches the ledger, whoever made it: the board
 * page's route for a person's drag or "not a task", and the realtime route for
 * the agent's tool call. Planning (which ops) is `planBoardEdit`; this only
 * appends in order and emits the yield event. Ops land with their idempotent
 * row ids, so a retried request is a no-op at the primary key.
 */
export async function applyBoardEdit(input: {
  userId: string;
  ops: readonly StoredOp[];
  plan: Applied;
  by: "user" | "agent";
  /** The drive the agent's edit happened in; a drag on the page has none. */
  captureSessionId?: string;
  /** PostHog's browser session, when the edit came from a browser. */
  analyticsSessionId?: string;
  /**
   * The transaction this edit is being planned and written inside.
   *
   * Both callers hold one (see `withBoardLock`): load, plan and apply are one
   * critical section, and an append that reached for the pool instead would
   * land outside the lock that is guarding it.
   */
  db?: Executor;
}): Promise<void> {
  const { userId, ops, plan, by } = input;

  for (const row of plan.ops) {
    await appendUserOp({
      userId,
      id: row.id,
      op: row.op,
      captureSessionId: input.captureSessionId,
      db: input.db,
    });
  }

  const card = plan.card;
  const previous = plan.previous;
  const options = input.analyticsSessionId ? { sessionId: input.analyticsSessionId } : undefined;
  const last = plan.ops.at(-1)!.op;

  if (last.type === "retire_block") {
    capture(
      userId,
      "board_card_retired",
      {
        block_id: last.blockId,
        card_id: card.cardId,
        state: plan.from ?? "open",
        by,
        previous_via: previous?.via ?? null,
      },
      options,
    );
    return;
  }

  if (last.type === "add_block") {
    capture(
      userId,
      "board_card_added",
      {
        card_id: card.cardId,
        state: last.state ?? "open",
        by: "agent",
        topic_created: plan.ops.some((o) => o.op.type === "create_topic"),
      },
      options,
    );
    return;
  }

  if (last.type === "revise_block" && plan.from !== null && last.state && last.state !== plan.from) {
    capture(
      userId,
      "board_card_moved",
      {
        block_id: last.blockId,
        card_id: card.cardId,
        from_state: plan.from,
        to_state: last.state,
        by,
        previous_via: previous?.via ?? null,
        // Putting the card back where a machine had moved it from is the
        // reversal the study is built to count.
        reverses_speech: previous?.via === "speech" && previous.from === last.state,
        reverses_agent: previous?.via === "agent" && previous.from === last.state,
        sessions_since_last_transition: previous
          ? sessionsSince(ops, previous.seq, previous.captureSessionId)
          : 0,
      },
      options,
    );
    return;
  }

  if (last.type === "revise_block" && by === "agent") {
    capture(userId, "board_card_reworded", { card_id: card.cardId, block_id: last.blockId, by: "agent" }, options);
  }
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
