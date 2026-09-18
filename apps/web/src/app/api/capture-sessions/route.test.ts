/**
 * Integration tests for the use case a drive is started under.
 *
 * The properties worth asserting are the ones the probe's numbers depend on: a
 * drive started from a `/welcome` card carries that card, a drive started any
 * other way carries null, and a RESUMED drive keeps whatever it opened with —
 * the same rule `setting`, `voiceId` and the study condition already follow. A
 * drive whose second half claims a different intent is not interpretable, and
 * "which example did they abandon" is exactly the question a mutable column
 * would answer wrongly.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-use-case-user";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { captureSession, user } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const SESSION_A = "00000000-0000-4000-8000-0000000e1a01";
const SESSION_B = "00000000-0000-4000-8000-0000000e1a02";

async function seed() {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.insert(user).values({ id: USER_ID, name: "U", email: `${USER_ID}@test.local` });
}

function open(id: string, extra: Record<string, unknown> = {}) {
  return POST(
    new Request("http://test/api/capture-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        startedAt: new Date().toISOString(),
        setting: "desk",
        deviceInfo: {},
        ...extra,
      }),
    }),
  );
}

async function storedUseCase(id: string) {
  const [row] = await getDb()
    .select({ useCase: captureSession.useCase })
    .from(captureSession)
    .where(eq(captureSession.id, id))
    .limit(1);
  return row?.useCase ?? null;
}

describeIfDb("POST /api/capture-sessions — the use case a drive begins under", () => {
  beforeEach(seed);

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("records the worked example a drive was started from", async () => {
    const res = await open(SESSION_A, { useCase: "draft" });
    expect(res.status).toBe(201);
    expect(await storedUseCase(SESSION_A)).toBe("draft");
  });

  it("leaves it null for a drive started any other way", async () => {
    // Straight from /record, from a bookmark, or before /welcome existed —
    // and every drive of the longitudinal deployment, which is unseeded.
    await open(SESSION_B);
    expect(await storedUseCase(SESSION_B)).toBeNull();
  });

  it("does not let a resumed drive change the example it opened under", async () => {
    await open(SESSION_A, { useCase: "think_aloud" });

    const again = await open(SESSION_A, { useCase: "recall" });
    expect(await again.json()).toMatchObject({ resumed: true });
    // Same rule as `setting`: it describes the intent the recording began with.
    expect(await storedUseCase(SESSION_A)).toBe("think_aloud");
  });

  it("refuses an example that is not one of the three", async () => {
    const res = await open(SESSION_B, { useCase: "buy_groceries" });
    expect(res.status).toBe(400);
    // Nothing was opened, so the recorder retries rather than filing a drive
    // under a value no analysis can read.
    expect(await storedUseCase(SESSION_B)).toBeNull();
  });

  it("gives every new account the board", async () => {
    // It used to be null until a researcher ran an UPDATE, which is why the
    // first peers met an agent with no board to act on and reported the system
    // as "an organizer for voice memos".
    const [row] = await getDb()
      .select({ at: user.boardEnabledAt })
      .from(user)
      .where(eq(user.id, USER_ID))
      .limit(1);
    expect(row?.at).toBeInstanceOf(Date);
  });
});
