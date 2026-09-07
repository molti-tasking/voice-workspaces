/**
 * Integration tests for the board's one mutating route.
 *
 * The properties worth asserting are about the ledger, not the JSON: a move
 * is a `revise_block` that keeps the text, a retried POST cannot append twice,
 * a move aimed at a stale block id lands on the card's current block, and a
 * card that is not a task — or no longer on the board — refuses.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-board-route-user";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { user, workspaceOp } = await import("@voicemural/db/schema");
const { enableBoard } = await import("@voicemural/db/board");
const { loadOps, loadUserOps } = await import("@voicemural/db/workspace");
const { foldBoard, foldWorkspace } = await import("@voicemural/workspace");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const T0 = new Date("2026-09-14T08:00:00Z");

async function seed(opts: { enabled?: boolean } = {}) {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.insert(user).values({ id: USER_ID, name: "R", email: `${USER_ID}@test.local` });
  if (opts.enabled !== false) await enableBoard(USER_ID);

  const rows = [
    { type: "create_topic" as const, payload: { topicId: "t", title: "Research stay" } },
    {
      type: "add_block" as const,
      payload: { blockId: "task-1", topicId: "t", kind: "task", state: "next", text: "Email William.", spans: [{ utteranceId: "u1" }] },
    },
    {
      type: "add_block" as const,
      payload: { blockId: "claim-1", topicId: "t", kind: "claim", text: "A claim.", spans: [] },
    },
  ];
  for (const [i, row] of rows.entries()) {
    await db.insert(workspaceOp).values({
      userId: USER_ID,
      type: row.type,
      payload: row.payload,
      occurredAt: new Date(T0.getTime() + i * 1000),
      sourceUtteranceIds: [],
    });
  }
}

function post(blockId: string, body: unknown) {
  return POST(
    new Request(`http://test/api/board/cards/${blockId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ blockId }) },
  );
}

const OP_A = "00000000-0000-4000-8000-00000000c0a1";
const OP_B = "00000000-0000-4000-8000-00000000c0a2";
const OP_C = "00000000-0000-4000-8000-00000000c0a3";

describeIfDb("POST /api/board/cards/[blockId]", () => {
  beforeEach(() => seed());

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("moves a card by appending a revise that keeps the text and its provenance", async () => {
    const res = await post("task-1", { action: "set_state", state: "done", opId: OP_A });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", blockId: OP_A, state: "done" });

    const board = foldBoard(await loadOps(USER_ID));
    expect(board.columns.done).toHaveLength(1);
    expect(board.columns.next).toHaveLength(0);

    const card = board.columns.done[0]!;
    expect(card.cardId).toBe("task-1");
    expect(card.block.id).toBe(OP_A);
    expect(card.block.text).toBe("Email William.");
    expect(card.block.spans).toEqual([{ utteranceId: "u1" }]);
    expect(card.lastTransition).toMatchObject({ from: "next", to: "done", via: "user" });
  });

  it("appends once however many times the same opId is retried", async () => {
    await post("task-1", { action: "set_state", state: "done", opId: OP_A });
    await post("task-1", { action: "set_state", state: "done", opId: OP_A });
    await post(OP_A, { action: "set_state", state: "done", opId: OP_A });

    expect(await loadUserOps(USER_ID)).toHaveLength(1);
    expect(foldBoard(await loadOps(USER_ID)).cards).toHaveLength(1);
  });

  it("records nothing for a move to the column the card is already in", async () => {
    const res = await post("task-1", { action: "set_state", state: "next", opId: OP_A });
    expect(await res.json()).toMatchObject({ status: "unchanged" });
    expect(await loadUserOps(USER_ID)).toHaveLength(0);
  });

  it("lands a move aimed at a stale block id on the card's current block", async () => {
    // The page showed task-1; speech (or an earlier move) has since revised it.
    await post("task-1", { action: "set_state", state: "doing", opId: OP_A });
    const res = await post("task-1", { action: "set_state", state: "done", opId: OP_B });
    expect(res.status).toBe(200);

    const state = foldWorkspace(await loadOps(USER_ID));
    const visible = [...state.blocksByTopic.values()].flat().filter((b) => b.kind === "task");
    expect(visible.map((b) => b.id)).toEqual([OP_B]);
    expect(state.allBlocks.get(OP_B)?.supersedes).toBe(OP_A);
  });

  it("retires a card, after which it is not a task any more", async () => {
    const res = await post("task-1", { action: "retire", opId: OP_A });
    expect(await res.json()).toEqual({ status: "ok", retired: true });
    expect(foldBoard(await loadOps(USER_ID)).cards).toEqual([]);

    const again = await post("task-1", { action: "set_state", state: "done", opId: OP_B });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "not_a_task" });
  });

  it("refuses a block that is not a task", async () => {
    const res = await post("claim-1", { action: "set_state", state: "done", opId: OP_C });
    expect(res.status).toBe(409);
    expect(await loadUserOps(USER_ID)).toHaveLength(0);
  });

  it("is not found for a block that is not in this person's ledger", async () => {
    const res = await post("someone-elses", { action: "retire", opId: OP_C });
    expect(res.status).toBe(404);
  });

  it("rejects a body without an opId", async () => {
    const res = await post("task-1", { action: "set_state", state: "done" });
    expect(res.status).toBe(400);
  });

  it("is not found while the board is switched off for this person", async () => {
    await seed({ enabled: false });
    const res = await post("task-1", { action: "set_state", state: "done", opId: OP_A });
    expect(res.status).toBe(404);
  });
});
