/**
 * Integration tests for the import route.
 *
 * The properties worth asserting are about the ledger, not the JSON: imported
 * cards arrive under `via: "import"` with no spans, a retried submit cannot
 * append the same board twice, a task already on the board is refused rather
 * than duplicated, and `loadUserOps` keeps imports — which is what stops
 * `workspace:rebuild` emptying the board of everything the person brought with
 * them.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-board-import-user";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { user, workspaceOp } = await import("@voicemural/db/schema");
const { enableBoard } = await import("@voicemural/db/board");
const { loadOps, loadUserOps } = await import("@voicemural/db/workspace");
const { KEPT_AFTER_SESSIONS, foldBoard, judge } = await import("@voicemural/workspace");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const T0 = new Date("2026-09-14T08:00:00Z");
const BATCH_A = "00000000-0000-4000-8000-0000000000a1";
const BATCH_B = "00000000-0000-4000-8000-0000000000a2";

/** One task speech already put on the board, so duplicates have something to hit. */
/**
 * Switch the board off for a test of the gate.
 *
 * The column defaults to `now()` since the peer week, so a freshly inserted
 * user HAS a board — which is the point. A test of what happens without one has
 * to say so deliberately.
 */
async function disableBoard(): Promise<void> {
  await getDb().update(user).set({ boardEnabledAt: null }).where(eq(user.id, USER_ID));
}

async function seed(opts: { enabled?: boolean } = {}) {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.insert(user).values({ id: USER_ID, name: "R", email: `${USER_ID}@test.local` });
  if (opts.enabled === false) await disableBoard();
  else await enableBoard(USER_ID);

  const rows = [
    { type: "create_topic" as const, payload: { topicId: "t", title: "Research stay" } },
    {
      type: "add_block" as const,
      payload: {
        blockId: "task-1",
        topicId: "t",
        kind: "task",
        state: "next",
        text: "Email William.",
        spans: [{ utteranceId: "u1" }],
      },
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
    new Request("http://test/api/board/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const IMPORT = {
  batchId: BATCH_A,
  format: "outline" as const,
  tasks: [
    { text: "Book the ferry", state: "next" as const, topic: "Trip" },
    { text: "Renew the pass", state: "doing" as const, topic: "Trip" },
  ],
};

describeIfDb("POST /api/board/import", () => {
  beforeEach(() => seed());

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("writes the tasks as cards under via: import, with no spans", async () => {
    const res = await post(IMPORT);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: 2, topicsCreated: ["Trip"] });

    const board = foldBoard(await loadOps(USER_ID));
    expect(board.columns.next.map((c) => c.block.text)).toEqual(["Book the ferry", "Email William."]);
    expect(board.columns.doing.map((c) => c.block.text)).toEqual(["Renew the pass"]);

    const imported = board.cards.find((c) => c.block.text === "Book the ferry")!;
    expect(imported.lastTransition).toMatchObject({ from: null, to: "next", via: "import" });
    // No utterance said it, so there is nothing to seek back to.
    expect(imported.block.spans).toEqual([]);
    expect(imported.topic.title).toBe("Trip");
  });

  it("appends once however many times the same batch is retried", async () => {
    await post(IMPORT);
    await post(IMPORT);

    // Two adds and the one topic they needed.
    expect(await loadUserOps(USER_ID)).toHaveLength(3);
    expect(foldBoard(await loadOps(USER_ID)).cards).toHaveLength(3);
  });

  it("refuses a task the board already carries, even under a fresh batch", async () => {
    const res = await post({
      batchId: BATCH_B,
      format: "table" as const,
      tasks: [{ text: "email william", state: "open" as const }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      imported: 0,
      skipped: [{ text: "email william", reason: "duplicate" }],
    });
    expect(await loadUserOps(USER_ID)).toHaveLength(0);
  });

  it("keeps imported ops where a rebuild can restore them", async () => {
    await post(IMPORT);
    // `loadUserOps` is what `workspace:rebuild` saves before it clears the log.
    // An import missing from it would leave the person's board empty.
    const saved = await loadUserOps(USER_ID);
    expect(saved).toHaveLength(3);
    expect(saved.every((o) => (o.op as { via?: string }).via === "import")).toBe(true);
  });

  it("does not put imported cards into the acceptance measure", async () => {
    await post(IMPORT);
    const board = foldBoard(await loadOps(USER_ID));
    const judged = judge(board.transitions, {
      withinSessions: KEPT_AFTER_SESSIONS,
      sessions: board.sessions,
    });

    // Only the card speech made is judged; the two imported ones are the
    // person's own record, not a reading of anything they said.
    expect(judged.map((j) => j.transition.via)).toEqual(["speech"]);
  });

  it("refuses a body that is not a task list", async () => {
    expect((await post({ batchId: BATCH_A, format: "outline", tasks: [] })).status).toBe(400);
    expect((await post({ batchId: "not-a-uuid", format: "outline", tasks: IMPORT.tasks })).status).toBe(400);
    expect(await loadUserOps(USER_ID)).toHaveLength(0);
  });

  it("is not found while the person has no board", async () => {
    await seed({ enabled: false });
    const res = await post(IMPORT);
    expect(res.status).toBe(404);
    expect(await loadUserOps(USER_ID)).toHaveLength(0);
  });
});
