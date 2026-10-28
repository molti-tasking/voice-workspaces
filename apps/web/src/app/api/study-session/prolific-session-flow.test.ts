/**
 * The display study from Prolific, through its routes: consent from the study
 * link makes the session in the active setup and hands the page its block,
 * a reload finds the same one, and the last questions hand back the
 * completion code — the one moment the code reaches the browser.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-prolific-session-flow";
// As Prolific issues them: 24 hex characters, so the session is a real one, not a test.
const PID = "00000000000000000f20a0de";
// This file's own drive id: another test file's would collide when turbo runs them in parallel.
const DRIVE = "00000000-0000-4000-8000-0000000f20a0";

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-study-session";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { captureSession, studySession, user } = await import("@voicemural/db/schema");
const { activeDesign, designPlan } = await import("@voicemural/db/study-session");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { cellFor, prolificCompletionUrl } = await import("@voicemural/shared");
const enroll = (await import("./enroll/route")).POST;
const step = (await import("./route")).POST;
const openDrive = (await import("../capture-sessions/route")).POST;

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

function call(route: (req: Request) => Promise<Response>, body: Record<string, unknown>) {
  return route(
    new Request("http://localhost/api/study-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const ANSWERS = {
  summary: "We picked the train and a hostel near the station; food is still open.",
  follow: 5,
  effort: 3,
  pickup: 4,
  beforeGame: "Where to stay.",
  wayBack: "I looked at the screen.",
  glance: 4,
};

describeIfDb("the display study's session from Prolific", () => {
  const prolific = { pid: PID, studyId: "study-f20a", sessionId: "session-f20a" };

  async function clean() {
    const db = getDb();
    await db.delete(studySession).where(eq(studySession.prolificPid, PID));
    await db.delete(captureSession).where(eq(captureSession.id, DRIVE));
    await db.delete(user).where(eq(user.id, USER_ID));
  }

  beforeAll(async () => {
    await clean();
    await getDb().insert(user).values({ id: USER_ID, name: "Guest", email: `${USER_ID}@test.local`, isAnonymous: true });
  });

  afterAll(async () => {
    await clean();
    await closeDb();
  });

  it("makes the session on consent, in the active setup, and hands the page its block", async () => {
    expect((await call(enroll, { prolific: { pid: "no" }, consent: true })).status).toBe(400);
    expect((await call(enroll, { prolific })).status).toBe(400);

    const res = await call(enroll, { prolific, consent: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resume: unknown; block: { position: number; display: string; task: { title: string } } };
    expect(body.resume).toEqual({ at: "brief", position: 0 });

    const [row] = await getDb().select().from(studySession).where(eq(studySession.prolificPid, PID));
    const design = (await activeDesign())!;
    expect(row).toMatchObject({
      source: "prolific",
      design: design.name,
      prolificStudyId: "study-f20a",
      prolificSessionId: "session-f20a",
      userId: USER_ID,
      test: false,
    });
    expect(body.block).toMatchObject({ position: 0, display: cellFor(designPlan(design), row!.orderIndex).display });
    expect(body.block.task.title).toBeTruthy();

    // A reload is the same session, not a second one.
    const again = (await (await call(enroll, { prolific, consent: true })).json()) as { block: unknown };
    expect(again.block).toEqual(body.block);
    expect(await getDb().select().from(studySession).where(eq(studySession.prolificPid, PID))).toHaveLength(1);
  });

  it("hands back the completion code with the last questions, and not before", async () => {
    expect((await call(step, { step: "arm", position: 0 })).status).toBe(200);
    expect((await call(openDrive, { id: DRIVE, startedAt: new Date().toISOString(), deviceInfo: {} })).status).toBeLessThan(300);
    expect(await (await call(step, { step: "linked", position: 0, captureSessionId: DRIVE })).json()).toEqual({ linked: true });
    expect((await call(step, { step: "finished", position: 0 })).status).toBe(200);

    const answered = await call(step, { step: "answers", position: 0, answers: ANSWERS });
    expect(await answered.json()).toEqual({ ok: true });

    const done = (await (await call(step, { step: "final", final: { contact: false } })).json()) as Record<string, unknown>;
    // The active setup's code, or outside production a made-up one where it has none.
    const code = (await activeDesign())!.completionCode ?? "TEST-SESSION";
    expect(done).toEqual({ ok: true, completion: { code, url: prolificCompletionUrl(code) } });

    const reopened = (await (await call(enroll, { prolific, consent: true })).json()) as { resume: unknown };
    expect(reopened.resume).toEqual({ at: "done" });
  });
});
