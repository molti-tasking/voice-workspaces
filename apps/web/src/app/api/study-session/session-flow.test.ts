/**
 * The display study's session end to end through its routes: consent on the
 * link, then its one conversation — armed, the drive registered under the
 * block's view, the agent set up as the session's own, finished, answered —
 * and the last questions. Steps out of turn are refused.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-study-session-flow";
const REF = "TST-FLOW-1";
// This file's own drive ids: another test file's would collide when turbo runs them in parallel.
const DRIVES = ["00000000-0000-4000-8000-0000000f10a0"];

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-study-session";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { studySession, user } = await import("@voicemural/db/schema");
const { createSession } = await import("@voicemural/db/study-session");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { issueTicket } = await import("@voicemural/shared/realtime-ticket");
const { CONVERSATION_DISPLAYS } = await import("@voicemural/shared");
const { SESSION_OPENING_NUDGE, SESSION_SYSTEM_PROMPT, SPEECH_ONLY_CONTRACT, STUDY_SCREEN } = await import("@voicemural/talkback");
const enroll = (await import("./enroll/route")).POST;
const step = (await import("./route")).POST;
const openDrive = (await import("../capture-sessions/route")).POST;
const realtimeSession = (await import("../realtime/session/route")).POST;
const realtimeContext = (await import("../realtime/context/route")).POST;

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

const ANSWERS = { summary: "We went for the train and two nights in Aarhus; food is still open.", follow: 6, effort: 2, glance: 3 };

describeIfDb("the display study's session routes", () => {
  let code = "";
  let displays: string[] = [];

  beforeAll(async () => {
    const db = getDb();
    await db.delete(studySession).where(eq(studySession.ref, REF));
    await db.delete(user).where(eq(user.id, USER_ID));
    await db.insert(user).values({ id: USER_ID, name: "Guest", email: `${USER_ID}@test.local`, isAnonymous: true });
    const { session, blocks } = await createSession({ ref: REF, orderIndex: 2 });
    code = session.inviteCode!;
    displays = blocks.map((b) => b.display);
  });

  afterAll(async () => {
    await getDb().delete(studySession).where(eq(studySession.ref, REF));
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("takes consent on a real link only, and opens on the first block", async () => {
    expect((await call(enroll, { code: "no-such-session-code", consent: true })).status).toBe(404);
    expect((await call(enroll, { code })).status).toBe(400);
    const res = await call(enroll, { code, consent: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, resume: { at: "brief", position: 0 } });
  });

  it("refuses a block it does not have, and answers before the conversation", async () => {
    expect((await call(step, { step: "arm", position: 1 })).status).toBe(400);
    expect((await call(step, { step: "answers", position: 0, answers: ANSWERS })).status).toBe(409);
    expect((await call(step, { step: "finished", position: 0 })).status).toBe(409);
    const early = { kind: "esm", ordinal: 0, item: "esm_follow", shownOffsetMs: 1_000, answeredOffsetMs: null, value: null, text: null };
    expect((await call(step, { step: "moment", position: 0, moment: early })).status).toBe(409);
  });

  it("runs the block's drive under its view, with the session's agent", async () => {
    for (const [position, id] of DRIVES.entries()) {
      expect((await call(step, { step: "arm", position })).status).toBe(200);
      const opened = await call(openDrive, { id, startedAt: new Date().toISOString(), deviceInfo: {} });
      const { studyCondition } = (await opened.json()) as { studyCondition: { display: string; sparks: boolean } };
      expect(studyCondition.display).toBe(displays[position]);
      expect(studyCondition.sparks).toBe(false);
      expect(await (await call(step, { step: "linked", position, captureSessionId: id })).json()).toEqual({ linked: true });

      const { ticket } = issueTicket({ userId: USER_ID, captureSessionId: id }, { ttlMs: 60_000 });
      const setup = (await (await call(realtimeSession, { ticket })).json()) as {
        systemPrompt: string;
        tools: unknown[];
        webSearchTool: string | null;
        openingNudge: string | null;
      };
      expect(setup.systemPrompt.startsWith(SESSION_SYSTEM_PROMPT)).toBe(true);
      expect(setup.systemPrompt).toContain("THE PROBLEM");
      expect(setup.systemPrompt.endsWith(SPEECH_ONLY_CONTRACT)).toBe(true);
      expect(setup.systemPrompt).not.toMatch(/souffleur/i);
      expect(setup.openingNudge).toBe(SESSION_OPENING_NUDGE);
      expect(setup.tools).toEqual([]);
      expect(setup.webSearchTool).toBeNull();
      const turn = (await (await call(realtimeContext, { ticket, said: "what did we decide last time?" })).json()) as {
        screen: string;
        passages: unknown[];
        board: string | null;
      };
      expect(turn.screen).toBe(STUDY_SCREEN);
      expect(turn.passages).toEqual([]);
      expect(turn.board).toBeNull();

      const moment = { kind: "game", ordinal: 0, item: "tic_tac_toe", shownOffsetMs: 140_000, answeredOffsetMs: 205_000, value: null, text: null, meta: { rounds: 4 } };
      expect((await call(step, { step: "moment", position, moment })).status).toBe(200);
      // A retry is fine, and changes nothing.
      expect((await call(step, { step: "moment", position, moment: { ...moment, meta: { rounds: 9 } } })).status).toBe(200);

      expect((await call(step, { step: "finished", position })).status).toBe(200);
      expect((await call(step, { step: "final", final: { ranking: [...CONVERSATION_DISPLAYS], contact: false } })).status).toBe(409);
      expect((await call(step, { step: "answers", position, answers: ANSWERS })).status).toBe(200);
    }
  });

  it("is complete with the ranking, and a reload opens on the end", async () => {
    const final = { ranking: [...CONVERSATION_DISPLAYS].reverse(), why: "The transcript let me reread.", contact: true };
    expect((await call(step, { step: "final", final })).status).toBe(200);
    const again = await call(enroll, { code, consent: true });
    expect(await again.json()).toMatchObject({ resume: { at: "done" } });
  });
});
