/**
 * Determinism tests for workspace extraction.
 *
 * These are the whole point of persisting extractions. The claim is not "the
 * model usually gives the same answer" — it is that replaying a transcript
 * makes NO model calls at all, so the workspace is reproducible rather than
 * merely re-derivable. That is only believable if it is asserted directly, so
 * the LLM is mocked and the call count is the assertion.
 *
 * Needs the local Postgres; skipped when DATABASE_URL is absent.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/** Counts calls so "the cache prevented a call" is a measurable claim. */
const chatMock = vi.fn();

vi.mock("@voicemural/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voicemural/llm")>();
  return { ...actual, chat: chatMock };
});

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { audioChunk, captureSession, user, utterance } = await import(
  "@voicemural/db/schema"
);
const {
  clearExtractions,
  clearOps,
  loadExtractions,
  loadOps,
  resetCursor,
} = await import("@voicemural/db/workspace");
const { foldWorkspace } = await import("@voicemural/workspace");
const { extractWorkspace } = await import("./extract-workspace");

const USER_ID = "test-extract-user";
const SESSION_ID = "00000000-0000-4000-8000-0000000000e1";

const RESPONSE = JSON.stringify({
  ops: [
    { type: "create_topic", id: "new:research-stay", title: "Research stay" },
    {
      type: "add_block",
      topic: "new:research-stay",
      kind: "question",
      text: "Where do I actually want to go?",
      sources: ["*"],
    },
  ],
});

function reply(content: string) {
  return {
    content,
    resolvedModel: "test/model-resolved",
    requestedModel: "test/model-requested",
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    latencyMs: 42,
  };
}

const { isDatabaseReachable } = await import("@voicemural/db/testing");
const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seedTranscript(lines: string[]) {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db
    .insert(user)
    .values({ id: USER_ID, name: "Test", email: `${USER_ID}@test.local` });

  await db.insert(captureSession).values({
    id: SESSION_ID,
    userId: USER_ID,
    startedAt: new Date("2026-08-01T08:00:00Z"),
    endedAt: new Date("2026-08-01T08:30:00Z"),
  });

  const [chunk] = await db
    .insert(audioChunk)
    .values({
      captureSessionId: SESSION_ID,
      seq: 0,
      startOffsetMs: 0,
      durationMs: 10_000,
      mimeType: "audio/webm",
      byteSize: 0,
      checksum: "test",
      storageKey: null,
      status: "transcribed",
    })
    .returning({ id: audioChunk.id });

  await db.insert(utterance).values(
    lines.map((text, i) => ({
      captureSessionId: SESSION_ID,
      chunkId: chunk!.id,
      startOffsetMs: i * 1000,
      endOffsetMs: i * 1000 + 900,
      text,
      kind: "content" as const,
    })),
  );
}

const LINES = [
  "I'm thinking about my research stay.",
  "I don't know where I want to go yet.",
  "Let me start from the beginning.",
  "I have a PhD in my second year.",
  "Right now I live in Aarhus.",
  "I work in human-computer interaction.",
  "Maybe Stanford, maybe somewhere in Europe.",
  "That is the thing I need to decide.",
];

describeIfDb("extractWorkspace", () => {
  beforeEach(async () => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(reply(RESPONSE));
    await seedTranscript(LINES);
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("calls the model once and appends the ops it returned", async () => {
    const outcome = await extractWorkspace(USER_ID);

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(outcome.cacheHit).toBe(false);
    expect(outcome.opsAppended).toBe(2);

    const state = foldWorkspace(await loadOps(USER_ID));
    expect(state.topics).toHaveLength(1);
    expect(state.topics[0]?.title).toBe("Research stay");
  });

  it("records tokens and the RESOLVED model, not the requested one", async () => {
    await extractWorkspace(USER_ID);
    const [stored] = await loadExtractions(USER_ID);

    expect(stored?.totalTokens).toBe(120);
    expect(stored?.promptTokens).toBe(100);
    expect(stored?.resolvedModel).toBe("test/model-resolved");
    expect(stored?.rawResponse).toBe(RESPONSE);
  });

  it("makes ZERO further calls when the same input recurs", async () => {
    // The determinism claim, asserted directly.
    await extractWorkspace(USER_ID);
    expect(chatMock).toHaveBeenCalledTimes(1);

    const first = await loadOps(USER_ID);

    // Rewind the cursor and the ops, leaving the extraction cache in place —
    // exactly what `workspace:rebuild` does.
    await clearOps(USER_ID);
    await resetCursor(USER_ID);

    const second = await extractWorkspace(USER_ID);

    expect(chatMock).toHaveBeenCalledTimes(1); // still one — the cache answered
    expect(second.cacheHit).toBe(true);

    const rebuilt = await loadOps(USER_ID);
    expect(rebuilt.map((o) => o.op)).toEqual(first.map((o) => o.op));
  });

  it("mints identical block ids across a rebuild", async () => {
    // Random ids would orphan every block on each rebuild and make the
    // guarantee worthless, so ids are derived from the input hash.
    await extractWorkspace(USER_ID);
    const before = foldWorkspace(await loadOps(USER_ID));

    await clearOps(USER_ID);
    await resetCursor(USER_ID);
    await extractWorkspace(USER_ID);
    const after = foldWorkspace(await loadOps(USER_ID));

    expect([...after.allBlocks.keys()].sort()).toEqual(
      [...before.allBlocks.keys()].sort(),
    );
  });

  it("calls the model again once the cache is dropped", async () => {
    await extractWorkspace(USER_ID);
    await clearOps(USER_ID);
    await resetCursor(USER_ID);
    await clearExtractions(USER_ID); // what `--force` does

    await extractWorkspace(USER_ID);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it("advances past speech that produced no ops", async () => {
    // Filler legitimately yields nothing. Not advancing would re-extract the
    // same stretch forever and burn tokens on every sweep.
    chatMock.mockResolvedValue(reply(JSON.stringify({ ops: [] })));

    const first = await extractWorkspace(USER_ID);
    expect(first.opsAppended).toBe(0);

    const second = await extractWorkspace(USER_ID);
    expect(second.skipped).toBe("nothing pending");
  });

  it("stores an unparseable response instead of throwing", async () => {
    // A bad extraction must never wedge the queue, and the raw text has to
    // survive so a parser fix can re-derive from it later.
    chatMock.mockResolvedValue(reply("I'm sorry, I can't help with that."));

    const outcome = await extractWorkspace(USER_ID);
    expect(outcome.opsAppended).toBe(0);

    const [stored] = await loadExtractions(USER_ID);
    expect(stored?.parseError).toBeTruthy();
    expect(stored?.rawResponse).toContain("I'm sorry");
  });

  it("keeps the good ops from a partially bad response", async () => {
    chatMock.mockResolvedValue(
      reply(
        JSON.stringify({
          ops: [
            { type: "create_topic", id: "new:t", title: "Kept" },
            { type: "add_block", topic: "new:t", kind: "nonsense", text: "dropped" },
          ],
        }),
      ),
    );

    const outcome = await extractWorkspace(USER_ID);
    expect(outcome.opsAppended).toBe(1);

    const [stored] = await loadExtractions(USER_ID);
    expect(stored?.parseWarnings.length).toBe(1);
  });

  it("does nothing when there is no new speech", async () => {
    await extractWorkspace(USER_ID);
    chatMock.mockClear();

    const outcome = await extractWorkspace(USER_ID);
    expect(outcome.skipped).toBe("nothing pending");
    expect(chatMock).not.toHaveBeenCalled();
  });
});
