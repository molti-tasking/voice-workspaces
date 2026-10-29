/**
 * Integration tests for starting a speech-to-speech call.
 *
 * What is pinned: the agent is composed on the server and minted into the
 * session (a block gets the display study's agent, and neither gets the text
 * pipeline's sentinel); the proxy key goes to the proxy and nowhere else; the
 * counters resume after the drive's own rows; and an ended or foreign drive
 * gets no call at all.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-realtime-call-user";
const OTHER_ID = "test-realtime-call-other";
const SESSION_ID = "00000000-0000-4000-8000-0000000ca101";
const ENDED_ID = "00000000-0000-4000-8000-0000000ca102";
const BLOCK_DRIVE_ID = "00000000-0000-4000-8000-0000000ca103";
const REF = "TEST-REALTIME-CALL";

vi.mock("@/lib/session", () => ({ currentUserId: async () => USER_ID }));

process.env.BETTER_AUTH_SECRET ??= "test-secret-for-call-route";

const { agentTurn, closeDb, getDb, inArray, eq } = await import("@voicemural/db");
const { captureSession, studyBlock, studySession, user } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { verifyTicket } = await import("@voicemural/shared/realtime-ticket");
const { DEFAULT_DESIGN } = await import("@voicemural/shared");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const minted = { value: "ek_test", expires_at: 1_793_050_505, session: { model: "gpt-realtime-2.1" } };

async function seed() {
  const db = getDb();
  await db.delete(studySession).where(eq(studySession.ref, REF));
  await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
  await db.insert(user).values([
    { id: USER_ID, name: "R", email: `${USER_ID}@test.local` },
    { id: OTHER_ID, name: "O", email: `${OTHER_ID}@test.local` },
  ]);
  await db.insert(captureSession).values([
    { id: SESSION_ID, userId: USER_ID, startedAt: new Date(Date.now() - 60_000), sttLanguage: "da" },
    { id: ENDED_ID, userId: USER_ID, startedAt: new Date(Date.now() - 400_000), endedAt: new Date() },
    { id: BLOCK_DRIVE_ID, userId: USER_ID, startedAt: new Date() },
  ]);
  // A reconnect: this drive already has three turns.
  await db.insert(agentTurn).values(
    [0, 1, 2].map((seq) => ({
      captureSessionId: SESSION_ID,
      seq,
      startOffsetMs: seq * 1000,
      endOffsetMs: seq * 1000 + 500,
      text: "Hello there, how are you?",
      generatedText: "Hello there, how are you?",
    })),
  );
  const [session] = await db
    .insert(studySession)
    .values({ ref: REF, design: DEFAULT_DESIGN.name, orderIndex: 0, userId: USER_ID })
    .returning({ id: studySession.id });
  await db.insert(studyBlock).values({
    sessionId: session!.id,
    position: 0,
    display: "chat",
    task: "trip",
    captureSessionId: BLOCK_DRIVE_ID,
  });
}

function post(captureSessionId: string) {
  return POST(
    new Request("http://test/api/realtime/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureSessionId }),
    }),
  );
}

describeIfDb("POST /api/realtime/call", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await seed();
    process.env.MODEL_REALTIME = "openai/gpt-realtime-2.1";
    process.env.LITELLM_BASE_URL = "https://litellm.test";
    process.env.LITELLM_API_KEY = "sk-proxy-key";
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(minted)));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await getDb().delete(studySession).where(eq(studySession.ref, REF));
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("mints a call for the field agent, and resumes the counters after the drive's rows", async () => {
    const res = await post(SESSION_ID);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      clientSecret: "ek_test",
      callsUrl: "https://litellm.test/realtime/calls",
      requestedModel: "openai/gpt-realtime-2.1",
      resolvedModel: "gpt-realtime-2.1",
      seq: { turn: 3, decision: 0, floor: 0 },
      configVersion: "realtime-1",
      turnDetection: { type: "semantic_vad" },
    });
    expect(verifyTicket(body.ticket)).toMatchObject({ userId: USER_ID, captureSessionId: SESSION_ID });
    expect(JSON.stringify(body)).not.toContain("sk-proxy-key");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://litellm.test/realtime/client_secrets");
    expect(init.headers.Authorization).toBe("Bearer sk-proxy-key");
    const { session } = JSON.parse(init.body);
    expect(session.instructions).toContain("thinking companion");
    expect(session.instructions).toContain("Speak Danish throughout");
    expect(session.instructions).not.toContain("<silence>");
    expect(session.audio.input.transcription).toMatchObject({ language: "da" });
  });

  it("gives a display-study block the session agent, which says nothing of a screen it cannot see", async () => {
    const res = await post(BLOCK_DRIVE_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openingNudge).toMatch(/greet them/);

    const { session } = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(session.instructions).toContain("You have no name of your own");
    expect(session.instructions).toContain("WHICH SCREEN: the study's conversation page");
    expect(session.instructions).not.toContain("<silence>");
  });

  it("refuses a drive that has ended, and mints nothing", async () => {
    expect((await post(ENDED_ID)).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses somebody else's drive", async () => {
    await getDb().update(captureSession).set({ userId: OTHER_ID }).where(eq(captureSession.id, SESSION_ID));
    expect((await post(SESSION_ID)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints their live words beside the call when switched on, and goes ahead without them if refused", async () => {
    expect((await (await post(SESSION_ID)).json()).liveTranscription).toBeNull();

    process.env.REALTIME_LIVE_TRANSCRIBE_MODEL = "openai/gpt-live-transcribe";
    try {
      fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
        const { model } = JSON.parse(init.body) as { model: string };
        return new Response(JSON.stringify(model === "openai/gpt-live-transcribe" ? { value: "ek_live" } : minted));
      });
      const body = await (await post(SESSION_ID)).json();
      expect(body).toMatchObject({
        clientSecret: "ek_test",
        liveTranscription: { clientSecret: "ek_live", callsUrl: "https://litellm.test/realtime/calls" },
      });
      const live = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body)).find((b) => b.model === "openai/gpt-live-transcribe");
      expect(live.session).toMatchObject({
        type: "transcription",
        audio: { input: { transcription: { model: "gpt-live-transcribe", language: "da", delay: "low" } } },
      });

      // With OpenAI's own key, minted there: the session alone, and OpenAI's calls URL.
      process.env.OPENAI_API_KEY = "sk-openai-direct";
      fetchMock.mockImplementation(async (url: string) =>
        new Response(JSON.stringify(url.startsWith("https://api.openai.com/") ? { value: "ek_direct" } : minted)),
      );
      const direct = await (await post(SESSION_ID)).json();
      expect(direct.liveTranscription).toEqual({ clientSecret: "ek_direct", callsUrl: "https://api.openai.com/v1/realtime/calls" });
      const [directUrl, directInit] = fetchMock.mock.calls.find(([url]) => String(url).startsWith("https://api.openai.com/"))!;
      expect(directUrl).toBe("https://api.openai.com/v1/realtime/client_secrets");
      expect(directInit.headers.Authorization).toBe("Bearer sk-openai-direct");
      expect(JSON.parse(directInit.body)).not.toHaveProperty("model");
      expect(JSON.stringify(direct)).not.toContain("sk-openai-direct");
      delete process.env.OPENAI_API_KEY;

      // The proxy cannot do it: the call is not the worse for it.
      fetchMock.mockImplementation(async (_url: string, init: { body: string }) => {
        const { model } = JSON.parse(init.body) as { model: string };
        return model === "openai/gpt-live-transcribe"
          ? new Response('{"error":"unknown model"}', { status: 400 })
          : new Response(JSON.stringify(minted));
      });
      const without = await post(SESSION_ID);
      expect(without.status).toBe(200);
      expect(await without.json()).toMatchObject({ clientSecret: "ek_test", liveTranscription: null });
    } finally {
      delete process.env.REALTIME_LIVE_TRANSCRIBE_MODEL;
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("says the call is unavailable when the proxy refuses it", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"not supported in realtime mode"}', { status: 400 }));
    expect((await post(SESSION_ID)).status).toBe(502);
  });

  it("says it is not configured without a realtime model", async () => {
    delete process.env.MODEL_REALTIME;
    expect((await post(SESSION_ID)).status).toBe(503);
  });
});
