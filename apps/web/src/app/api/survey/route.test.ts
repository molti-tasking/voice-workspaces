/**
 * One document per person per survey, saved whole, sent once.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-survey-user";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { surveyResponse, user } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { GET, PUT } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

function put(body: Record<string, unknown>) {
  return PUT(
    new Request("http://localhost/api/survey", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function get(survey = "initial") {
  return GET(new Request(`http://localhost/api/survey?survey=${survey}`));
}

const MOMENT = {
  id: "m1",
  when: "Tuesday morning, on the way in",
  where: "driving",
  attention: "hands_and_eyes_busy",
  onMind: "How to structure the method section.",
  helped: 5,
  afterwards: ["board"],
};

describeIfDb("/api/survey", () => {
  beforeEach(async () => {
    const db = getDb();
    await db.delete(user).where(eq(user.id, USER_ID));
    await db.insert(user).values({ id: USER_ID, name: "S", email: `${USER_ID}@test.local` });
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("answers null before anything was saved", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("saves a draft and reads it back, unsent", async () => {
    const answers = { moments: [MOMENT], describe: "A notebook that listens." };
    const saved = await put({ survey: "initial", version: "initial-1", answers });
    expect(saved.status).toBe(200);
    expect((await saved.json()).submittedAt).toBeNull();

    const view = await (await get()).json();
    expect(view.answers).toEqual(answers);
    expect(view.version).toBe("initial-1");
    expect(view.submittedAt).toBeNull();
  });

  it("replaces the document rather than growing a second row", async () => {
    await put({ survey: "initial", version: "initial-1", answers: { moments: [MOMENT] } });
    await put({ survey: "initial", version: "initial-1", answers: { moments: [] } });
    const rows = await getDb()
      .select({ answers: surveyResponse.answers })
      .from(surveyResponse)
      .where(eq(surveyResponse.userId, USER_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.answers).toEqual({ moments: [] });
  });

  it("marks a send, and a later draft-save does not unsend it", async () => {
    const sent = await put({
      survey: "initial",
      version: "initial-1",
      answers: { moments: [MOMENT] },
      submit: true,
    });
    const sentAt = (await sent.json()).submittedAt;
    expect(sentAt).toEqual(expect.any(String));

    await put({
      survey: "initial",
      version: "initial-1",
      answers: { moments: [MOMENT], again: "If it remembered Tuesday." },
    });
    const view = await (await get()).json();
    expect(view.submittedAt).toBe(sentAt);
    expect(view.answers.again).toBe("If it remembered Tuesday.");
  });

  it("rejects a body the contract does not know", async () => {
    expect((await put({ survey: "initial", version: "initial-1", answers: { moments: "no" } })).status).toBe(400);
    expect((await put({ survey: "exit", version: "initial-1", answers: { moments: [] } })).status).toBe(400);
    expect(
      (await put({ survey: "initial", version: "initial-1", answers: { moments: [{ ...MOMENT, helped: 9 }] } }))
        .status,
    ).toBe(400);
    expect((await get("exit")).status).toBe(400);
  });
});
