/**
 * The findings survey: anyone may send, nobody is recorded, a resend replaces.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { anonymousSurveyResponse } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const ID = "6f1c2b9e-3d4a-4c5b-8e6f-7a8b9c0d1e2f";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/survey/findings", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function stored() {
  return getDb().select().from(anonymousSurveyResponse).where(eq(anonymousSurveyResponse.id, ID));
}

describeIfDb("/api/survey/findings", () => {
  beforeEach(async () => {
    await getDb().delete(anonymousSurveyResponse).where(eq(anonymousSurveyResponse.id, ID));
  });

  afterAll(async () => {
    await getDb().delete(anonymousSurveyResponse).where(eq(anonymousSurveyResponse.id, ID));
    await closeDb();
  });

  it("stores the document with the day and nothing that names the sender", async () => {
    const answers = { usage: "a_handful", neverDo: "Decide what matters." };
    const res = await post({ id: ID, version: "findings-1", answers });
    expect(res.status).toBe(200);

    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: ID,
      survey: "findings",
      version: "findings-1",
      answers,
      submittedOn: new Date().toISOString().slice(0, 10),
    });
  });

  it("replaces the document when the same browser sends again", async () => {
    await post({ id: ID, version: "findings-1", answers: { usage: "a_handful" } });
    await post({ id: ID, version: "findings-1", answers: { usage: "regularly", umuxEase: 6 } });

    const rows = await stored();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.answers).toEqual({ usage: "regularly", umuxEase: 6 });
  });

  it("refuses an empty document", async () => {
    const res = await post({ id: ID, version: "findings-1", answers: { neverDo: "   " } });
    expect(res.status).toBe(400);
    expect(await stored()).toHaveLength(0);
  });

  it("refuses answers off the scales and ids it did not make", async () => {
    expect((await post({ id: ID, version: "findings-1", answers: { silenceMatch: 9 } })).status).toBe(400);
    expect((await post({ id: "1", version: "findings-1", answers: { usage: "regularly" } })).status).toBe(400);
    expect(await stored()).toHaveLength(0);
  });

  it("answers a filled honeypot like anyone else, and stores nothing", async () => {
    const res = await post({ id: ID, version: "findings-1", answers: { usage: "regularly" }, website: "spam.example" });
    expect(res.status).toBe(200);
    expect(await stored()).toHaveLength(0);
  });

  it("refuses a body far larger than any real answer", async () => {
    const res = await post({ id: ID, version: "findings-1", answers: {} }, { "Content-Length": String(1024 * 1024) });
    expect(res.status).toBe(413);
  });
});
