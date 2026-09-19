/**
 * The board's change signal, through its one-shot JSON answer.
 *
 * The stream sends the same `version` on an interval; what is worth asserting
 * is that the version moves when anything writes to the board — here, the
 * agent's edit — and that nobody without a board gets a signal about one.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-board-stream-user";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { user } = await import("@voicemural/db/schema");
const { enableBoard } = await import("@voicemural/db/board");
const { appendUserOp } = await import("@voicemural/db/workspace");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { GET } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function version(): Promise<Response> {
  return GET(new Request("http://test/api/board/stream", { headers: { Accept: "application/json" } }));
}

describeIfDb("GET /api/board/stream", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(user).where(eq(user.id, USER_ID));
    await db.insert(user).values({ id: USER_ID, name: "S", email: `${USER_ID}@test.local` });
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("moves its version when the agent edits the board", async () => {
    await enableBoard(USER_ID);
    const before = (await (await version()).json()).version;

    await appendUserOp({
      userId: USER_ID,
      id: "00000000-0000-4000-8000-00000000e7a1",
      op: { type: "retire_block", blockId: "b1", via: "agent" },
    });

    const after = (await (await version()).json()).version;
    expect(after).not.toBe(before);
  });

  it("is not found while the board is switched off", async () => {
    // The column defaults to `now()` since the peer week, so this has to be
    // said deliberately rather than assumed of a fresh account.
    await getDb().update(user).set({ boardEnabledAt: null }).where(eq(user.id, USER_ID));
    expect((await version()).status).toBe(404);
  });
});
