/**
 * The lock that makes a board edit one critical section.
 *
 * THE FAILURE IT CLOSES. On the first formative pilot (19 Sep 2026)
 * `workspace_op` seq 191 and 193 are two `create_topic` operations, both titled
 * "Montag", written 3ms apart by two concurrent `add_task` tool calls. Each
 * planned its edit against a fold of the op log taken before the other's write,
 * so each decided the topic did not exist and made it. Extraction noticed and
 * merged them at seq 197 — the system healed itself — but a board that briefly
 * shows the same topic twice is a board the participant may act on.
 *
 * WHY THIS TEST AND NOT ONLY THE ROUTE'S. The route test issues three
 * `add_task` calls in parallel and asserts one topic, which is the invariant
 * that matters; but running the handlers in-process does not reproduce the
 * interleaving — measured with the lock removed, those three still produce one
 * topic. This drives two overlapping critical sections directly, so it fails
 * when the lock is not there, which is the only way a concurrency test earns
 * its place.
 *
 * Skipped when Postgres is unreachable — so check the counts, not the colour.
 */
import { config } from "dotenv";
config({
  path: new URL("../../../.env", import.meta.url).pathname,
  quiet: true,
});

import { afterAll, describe, expect, it } from "vitest";
import { isDatabaseReachable } from "./testing";
import { withBoardLock } from "./workspace";
import { closeDb } from "./index";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const USER = "test-board-lock-user";
const OTHER = "test-board-lock-other";

/** A section that yields in the middle, so an unlocked pair would interleave. */
function section(log: string[], label: string) {
  return async () => {
    log.push(`${label}:in`);
    // Two macrotask turns, which is far more than the gap a real edit leaves
    // between reading the op log and appending to it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    log.push(`${label}:out`);
  };
}

describeIfDb("withBoardLock", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("will not let two edits on one board overlap", async () => {
    const log: string[] = [];
    await Promise.all([
      withBoardLock(USER, section(log, "a")),
      withBoardLock(USER, section(log, "b")),
    ]);

    // Whichever went first, neither entered while the other was inside. That
    // is the whole guarantee: the fold one of them planned against cannot go
    // stale under it.
    expect(log).toHaveLength(4);
    expect(log[1]).toBe(`${log[0]!.split(":")[0]}:out`);
    expect(log[3]).toBe(`${log[2]!.split(":")[0]}:out`);
  });

  it("does not make two people wait for each other", async () => {
    // Per user, not global. Two participants editing at once is not a conflict,
    // and one container serves every drive on the deployment.
    const log: string[] = [];
    await Promise.all([
      withBoardLock(USER, section(log, "a")),
      withBoardLock(OTHER, section(log, "b")),
    ]);

    expect(log.slice(0, 2).sort()).toEqual(["a:in", "b:in"]);
  });

  it("releases the lock when the edit throws", async () => {
    // Transaction-scoped, so a rollback frees it and no failure path can
    // strand a participant's board behind a lock nobody holds any more.
    await expect(
      withBoardLock(USER, async () => {
        throw new Error("planner said no");
      }),
    ).rejects.toThrow("planner said no");

    const log: string[] = [];
    await withBoardLock(USER, section(log, "after"));
    expect(log).toEqual(["after:in", "after:out"]);
  });

  it("hands the transaction to the work, so its writes are inside the lock", async () => {
    // A helper that reached for `getDb()` would take another connection from
    // the pool and land its writes outside the transaction the lock is held
    // on — guarded section, unguarded writes.
    const seen = await withBoardLock(USER, async (db) => {
      const rows = await db.execute<{ held: boolean }>(
        // `pg_advisory_xact_lock` locks are visible in pg_locks for the holding
        // transaction, which is the one this query is running in.
        "select count(*) > 0 as held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()",
      );
      return Array.from(rows as Iterable<{ held: boolean }>)[0]!.held;
    });
    expect(seen).toBe(true);
  });
});
