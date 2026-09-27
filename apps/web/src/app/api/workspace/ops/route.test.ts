/**
 * Integration tests for the workspace's curation route.
 *
 * What matters is the ledger: an archive is a tombstone op with `via: "user"`,
 * undo is one more op rather than a deletion, a retried tap appends once, and
 * a phone can move a task without the board being switched on.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-workspace-ops-user";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { user, workspaceOp } = await import("@voicemural/db/schema");
const { loadOps, loadUserOps } = await import("@voicemural/db/workspace");
const { foldWorkspace } = await import("@voicemural/workspace");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const T0 = new Date("2026-09-14T08:00:00Z");

async function seed() {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.insert(user).values({ id: USER_ID, name: "R", email: `${USER_ID}@test.local` });
  // No board: the workspace is every participant's.
  await db.update(user).set({ boardEnabledAt: null }).where(eq(user.id, USER_ID));

  const rows = [
    { type: "create_topic" as const, payload: { topicId: "t", title: "Song list" } },
    {
      type: "add_block" as const,
      payload: { blockId: "task-1", topicId: "t", kind: "task", state: "open", text: "Print the list.", spans: [] },
    },
    {
      type: "add_block" as const,
      payload: { blockId: "fact-1", topicId: "t", kind: "fact", text: "Twelve songs.", spans: [] },
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

function post(body: unknown) {
  return POST(
    new Request("http://test/api/workspace/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const OP_A = "00000000-0000-4000-8000-00000000d0a1";
const OP_B = "00000000-0000-4000-8000-00000000d0a2";

describeIfDb("POST /api/workspace/ops", () => {
  beforeEach(() => seed());

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("archives a topic as a user tombstone, and restores it with a second op", async () => {
    expect((await post({ action: "retire_topic", topicId: "t", opId: OP_A })).status).toBe(200);
    let state = foldWorkspace(await loadOps(USER_ID));
    expect(state.topics).toHaveLength(0);
    expect(state.archivedTopics.map((t) => t.id)).toEqual(["t"]);

    expect((await post({ action: "restore_topic", topicId: "t", opId: OP_B })).status).toBe(200);
    state = foldWorkspace(await loadOps(USER_ID));
    expect(state.topics.map((t) => t.id)).toEqual(["t"]);

    const userOps = await loadUserOps(USER_ID);
    expect(userOps.map((o) => o.op.type)).toEqual(["retire_topic", "restore_topic"]);
    expect(userOps.every((o) => "via" in o.op && o.op.via === "user")).toBe(true);
  });

  it("appends once however many times the same tap is retried", async () => {
    await post({ action: "retire_block", blockId: "fact-1", opId: OP_A });
    const again = await post({ action: "retire_block", blockId: "fact-1", opId: OP_A });

    expect(again.status).toBe(200);
    expect(await loadUserOps(USER_ID)).toHaveLength(1);
  });

  it("archives any kind of item, not only tasks, and restores it", async () => {
    await post({ action: "retire_block", blockId: "fact-1", opId: OP_A });
    expect(foldWorkspace(await loadOps(USER_ID)).blocksByTopic.get("t")?.map((b) => b.id)).toEqual(["task-1"]);

    await post({ action: "restore_block", blockId: "fact-1", opId: OP_B });
    expect(foldWorkspace(await loadOps(USER_ID)).blocksByTopic.get("t")?.map((b) => b.id)).toEqual([
      "task-1",
      "fact-1",
    ]);
  });

  it("moves a task without a board", async () => {
    const res = await post({ action: "set_state", blockId: "task-1", state: "done", opId: OP_A });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", state: "done" });
  });

  it("refuses to move something that is not a task, and finds nothing that is not theirs", async () => {
    expect((await post({ action: "set_state", blockId: "fact-1", state: "done", opId: OP_A })).status).toBe(409);
    expect((await post({ action: "retire_topic", topicId: "nope", opId: OP_B })).status).toBe(404);
  });
});
