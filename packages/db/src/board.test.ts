/**
 * Integration tests for the board's writes.
 *
 * The properties worth asserting are SQL guarantees: that a retried POST cannot
 * append a second op, that the manual gestures can be read back apart from the
 * extractor's, and that enabling the board is a timestamp on the user row.
 *
 * Skipped when Postgres is unreachable — so check the counts, not the colour.
 */
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, eq, getDb, sql } from "./index";
import { isDatabaseReachable } from "./testing";
import { boardEnabledAt, enableBoard } from "./board";
import { appendOps, appendUserOp, loadOps, loadUserOps } from "./workspace";
import { extraction, user, workspaceOp } from "./schema";

const USER_ID = "test-board-user";
const OP_ID = "00000000-0000-4000-8000-00000000b0a1";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seed() {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.insert(user).values({ id: USER_ID, name: "B", email: `${USER_ID}@test.local` });
}

describeIfDb("board", () => {
  beforeEach(seed);

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("appends a user op once, however many times the same opId is posted", async () => {
    const op = { type: "retire_block" as const, blockId: "b1", via: "user" as const };

    expect(await appendUserOp({ userId: USER_ID, id: OP_ID, op })).toBe("inserted");
    expect(await appendUserOp({ userId: USER_ID, id: OP_ID, op })).toBe("duplicate");

    const [row] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceOp)
      .where(eq(workspaceOp.userId, USER_ID));
    expect(row?.count).toBe(1);

    const stored = await loadOps(USER_ID);
    expect(stored[0]?.op).toEqual(op);
    expect(stored[0]?.extractionId).toBeUndefined();
    expect(stored[0]?.captureSessionId).toBeUndefined();
  });

  it("reads back only the person's ops, not the extractor's", async () => {
    const db = getDb();
    const [x] = await db
      .insert(extraction)
      .values({
        userId: USER_ID,
        inputHash: "h",
        promptVersion: "4",
        requestedModel: "m",
        resolvedModel: "m",
        temperature: "0",
        stateDigest: "d",
        requestMessages: [],
        rawResponse: "{}",
      })
      .returning({ id: extraction.id });

    await appendOps({
      userId: USER_ID,
      extractionId: x!.id,
      ops: [{ type: "create_topic", topicId: "t", title: "T" }],
      occurredAt: new Date("2026-09-14T08:00:00Z"),
      sourceUtteranceIds: [],
    });
    await appendUserOp({
      userId: USER_ID,
      id: OP_ID,
      op: { type: "retire_block", blockId: "b1", via: "user" },
    });

    expect(await loadOps(USER_ID)).toHaveLength(2);
    const manual = await loadUserOps(USER_ID);
    expect(manual).toHaveLength(1);
    expect(manual[0]?.id).toBe(OP_ID);
  });

  it("is hidden until enabled, and keeps the first date once it is", async () => {
    expect(await boardEnabledAt(USER_ID)).toBeNull();

    const first = new Date("2026-09-20T09:00:00Z");
    await enableBoard(USER_ID, first);
    expect(await boardEnabledAt(USER_ID)).toEqual(first);

    await enableBoard(USER_ID, new Date("2026-10-01T09:00:00Z"));
    expect(await boardEnabledAt(USER_ID)).toEqual(first);
  });
});
