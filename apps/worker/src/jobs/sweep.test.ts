/**
 * The person properties the analysis joins on.
 *
 * `study_participant_id` is the only key from PostHog to a participant — the
 * analysis must never need a name or an email — so it is asserted directly on
 * what the sweep hands to PostHog, with telemetry mocked.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const setPersonPropertiesMock = vi.fn();

vi.mock("@voicemural/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voicemural/telemetry")>();
  return { ...actual, setPersonProperties: setPersonPropertiesMock };
});

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { captureSession, user } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { refreshPersonProperties } = await import("./sweep");

const USER_ID = "test-sweep-participant";
const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

describeIfDb("refreshPersonProperties", () => {
  beforeEach(async () => {
    setPersonPropertiesMock.mockReset();
    const db = getDb();
    await db.delete(user).where(eq(user.id, USER_ID));
    await db.insert(user).values({ id: USER_ID, name: "T", email: `${USER_ID}@test.local` });
    await db.insert(captureSession).values({
      id: "00000000-0000-4000-8000-0000000000f1",
      userId: USER_ID,
      startedAt: new Date("2026-09-01T08:00:00Z"),
    });
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("carries the participant id once the researcher has set it", async () => {
    await refreshPersonProperties(USER_ID);
    expect(setPersonPropertiesMock.mock.calls[0]?.[1]).not.toHaveProperty("study_participant_id");

    await getDb().update(user).set({ studyParticipantId: "P07" }).where(eq(user.id, USER_ID));
    await refreshPersonProperties(USER_ID);
    expect(setPersonPropertiesMock.mock.calls[1]?.[0]).toBe(USER_ID);
    expect(setPersonPropertiesMock.mock.calls[1]?.[1]).toMatchObject({
      study_participant_id: "P07",
      sessions_count: 1,
    });
  });
});
