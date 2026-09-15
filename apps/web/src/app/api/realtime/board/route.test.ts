/**
 * The agent's board route, against a real ledger.
 *
 * What matters is what lands in `workspace_op` and what the model is told: a
 * spoken "drop that" must write the same move a drag writes, marked
 * `via: "agent"` and tied to the drive; a call the planner refuses must write
 * nothing and say so in words the agent can repeat; and nothing may be written
 * for someone whose board is off.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { captureSession, user, workspaceOp } = await import("@voicemural/db/schema");
const { enableBoard } = await import("@voicemural/db/board");
const { loadOps, loadUserOps } = await import("@voicemural/db/workspace");
const { cardHandle, foldBoard } = await import("@voicemural/workspace");
const { issueTicket } = await import("@voicemural/shared/realtime-ticket");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const USER_ID = "test-realtime-board-user";
const SESSION = "00000000-0000-4000-8000-00000000d0b1";
const CARD = "00000000-0000-4000-8000-00000000d0b2";
const OP_A = "00000000-0000-4000-8000-00000000d0c1";
const OP_B = "00000000-0000-4000-8000-00000000d0c2";

async function seed(opts: { enabled?: boolean } = {}) {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.insert(user).values({ id: USER_ID, name: "R", email: `${USER_ID}@test.local` });
  await db.insert(captureSession).values({ id: SESSION, userId: USER_ID, startedAt: new Date() });
  if (opts.enabled !== false) await enableBoard(USER_ID);
  await db.insert(workspaceOp).values([
    {
      userId: USER_ID,
      type: "create_topic",
      payload: { topicId: "t", title: "Voice paper" },
      occurredAt: new Date("2026-09-14T08:00:00Z"),
      sourceUtteranceIds: [],
    },
    {
      userId: USER_ID,
      type: "add_block",
      payload: { blockId: CARD, topicId: "t", kind: "task", state: "next", text: "Write up the asymmetry argument.", spans: [] },
      occurredAt: new Date("2026-09-14T08:00:01Z"),
      sourceUtteranceIds: [],
    },
  ]);
}

function call(tool: string, args: Record<string, unknown>, opId = OP_A) {
  const { ticket } = issueTicket({ userId: USER_ID, captureSessionId: SESSION }, { ttlMs: 60_000 });
  return POST(
    new Request("http://test/api/realtime/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, opId, tool, arguments: args }),
    }),
  );
}

describeIfDb("POST /api/realtime/board", () => {
  beforeEach(() => seed());

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("drops a card when asked, as the agent, in this drive — and tells the model what changed", async () => {
    const res = await call("move_task", { card: cardHandle(CARD), column: "dropped" });
    expect(await res.json()).toEqual({
      ok: true,
      changed: true,
      task: "Write up the asymmetry argument.",
      column: "dropped",
      topic: "Voice paper",
      card: cardHandle(CARD),
    });

    const board = foldBoard(await loadOps(USER_ID));
    expect(board.columns.dropped.map((c) => c.cardId)).toEqual([CARD]);
    expect(board.transitions.at(-1)).toMatchObject({ via: "agent", from: "next", to: "dropped", captureSessionId: SESSION });
  });

  it("writes once however often the container retries the same call", async () => {
    await call("move_task", { card: cardHandle(CARD), column: "done" });
    await call("move_task", { card: cardHandle(CARD), column: "done" });
    expect(await loadUserOps(USER_ID)).toHaveLength(1);
  });

  it("adds a task to a new topic, and does not add it twice", async () => {
    const first = await call("add_task", { text: "Book the flights.", topic: "Research stay", column: "next" });
    expect(await first.json()).toMatchObject({ ok: true, changed: true, column: "next", topic: "Research stay" });

    const again = await call("add_task", { text: "book the flights", topic: "Research stay" }, OP_B);
    expect(await again.json()).toMatchObject({ ok: true, changed: false });
    expect(foldBoard(await loadOps(USER_ID)).columns.next).toHaveLength(2);
  });

  it("refuses an unknown card in words the agent can say, and writes nothing", async () => {
    const body = await (await call("move_task", { card: "ffffff", column: "done" })).json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/no card ffffff.*Nothing was changed/);
    expect(await loadUserOps(USER_ID)).toHaveLength(0);
  });

  it("refuses a call it cannot read", async () => {
    const body = await (await call("move_task", { card: cardHandle(CARD), column: "finished" })).json();
    expect(body).toMatchObject({ ok: false });
    expect(await loadUserOps(USER_ID)).toHaveLength(0);
  });

  it("writes nothing for someone whose board is off", async () => {
    await seed({ enabled: false });
    const body = await (await call("move_task", { card: cardHandle(CARD), column: "dropped" })).json();
    expect(body).toMatchObject({ ok: false });
    expect(await loadUserOps(USER_ID)).toHaveLength(0);
  });

  it("rejects a request without a valid ticket", async () => {
    const res = await POST(
      new Request("http://test/api/realtime/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: "nope", opId: OP_A, tool: "move_task", arguments: {} }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
