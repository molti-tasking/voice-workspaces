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

/** What each extraction reported, so the board's yield counts can be asserted. */
const captureMock = vi.fn();
const captureGenerationMock = vi.fn();

vi.mock("@voicemural/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voicemural/telemetry")>();
  return { ...actual, capture: captureMock, captureGeneration: captureGenerationMock };
});

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { audioChunk, capability, captureSession, directive, user, utterance } = await import(
  "@voicemural/db/schema"
);
const {
  clearExtractions,
  clearOps,
  loadExtractions,
  loadOps,
  resetCursor,
} = await import("@voicemural/db/workspace");
const { foldWorkspace, transitionsOf } = await import("@voicemural/workspace");
const { CLASSIFY_WAIT_MS, extractWorkspace } = await import("./extract-workspace");

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

type Kind = "content" | "directive" | "unclassified";

async function seedTranscript(
  lines: (string | { text: string; kind: Kind })[],
  opts: { sttLanguage?: string } = {},
) {
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
    sttLanguage: opts.sttLanguage ?? null,
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

  return db
    .insert(utterance)
    .values(
      lines.map((line, i) => ({
        captureSessionId: SESSION_ID,
        chunkId: chunk!.id,
        startOffsetMs: i * 1000,
        endOffsetMs: i * 1000 + 900,
        text: typeof line === "string" ? line : line.text,
        kind: typeof line === "string" ? ("content" as const) : line.kind,
      })),
    )
    .returning({ id: utterance.id, text: utterance.text });
}

/** Everything the model was shown on call `n`, as one string. */
function sentOnCall(n = 0): string {
  const messages = chatMock.mock.calls[n]?.[0] as { content: string }[] | undefined;
  return (messages ?? []).map((m) => m.content).join("\n");
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

  it("tells the model to write the workspace in the drive's own language", async () => {
    /* The first formative pilot was a German drive — `stt_language = de` — whose
     * blocks came out half in English: extraction `88c62dad` wrote "Clean
     * apartment (vacuum and dust)." and "Buy flowers for daughter." while three
     * other extractions on the same drive wrote German. Nothing had ever told
     * the model which language to write in, so it guessed per batch and the
     * participant's own board was half in a language she does not speak. */
    await seedTranscript(LINES, { sttLanguage: "de" });
    await extractWorkspace(USER_ID);

    expect(sentOnCall()).toContain("Deutsch");
  });

  it("says nothing about language on a drive that was auto-detected", async () => {
    // Instructing on a guess would be worse than not instructing.
    await extractWorkspace(USER_ID);
    expect(sentOnCall()).not.toMatch(/was recorded in/);
  });

  it("does not serve a German drive from a cache entry made without the instruction", async () => {
    // The language is part of the cache key precisely so this cannot happen:
    // otherwise the fix would be invisible on exactly the corpus that needs it.
    await extractWorkspace(USER_ID);
    expect(chatMock).toHaveBeenCalledTimes(1);

    await resetCursor(USER_ID);
    await clearOps(USER_ID);
    await seedTranscript(LINES, { sttLanguage: "de" });
    await extractWorkspace(USER_ID);
    expect(chatMock).toHaveBeenCalledTimes(2);
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

  it("moves a task through speech, and reports the move", async () => {
    // Sixteen lines: two batches. The first adds a task in `next`; the second
    // reports progress on it — the same text, a new state — so the board
    // should hold one card, in `done`, with a single speech transition.
    await seedTranscript([
      ...LINES,
      "I need to email William about the start date tomorrow.",
      "That is the first thing.",
      "Actually, I sent William the email this morning.",
      "So that one is sorted.",
      "Now the ethics form.",
      "It needs a data management plan.",
      "I should look at the template.",
      "That is enough for today.",
    ]);

    const first = JSON.stringify({
      ops: [
        { type: "create_topic", id: "new:research-stay", title: "Research stay" },
        {
          type: "add_block",
          topic: "new:research-stay",
          kind: "task",
          text: "Email William about the start date.",
          state: "next",
          sources: ["*"],
        },
      ],
    });
    chatMock.mockReset();
    captureMock.mockReset();
    captureGenerationMock.mockReset();
    chatMock.mockResolvedValueOnce(reply(first));

    await extractWorkspace(USER_ID);
    const after = foldWorkspace(await loadOps(USER_ID));
    const [card] = [...after.allBlocks.values()].filter((b) => b.kind === "task");
    expect(card?.state).toBe("next");

    const second = JSON.stringify({
      ops: [
        {
          type: "revise_block",
          supersedes: card!.id,
          topic: after.topics[0]!.id,
          kind: "task",
          text: "Email William about the start date.",
          state: "done",
          sources: ["*"],
        },
      ],
    });
    chatMock.mockResolvedValueOnce(reply(second));
    await extractWorkspace(USER_ID);

    const ops = await loadOps(USER_ID);
    const state = foldWorkspace(ops);
    const visible = [...state.blocksByTopic.values()].flat().filter((b) => b.kind === "task");
    expect(visible).toHaveLength(1);
    expect(visible[0]?.state).toBe("done");

    const transitions = transitionsOf(ops);
    const moves = transitions.filter((t) => t.from !== null);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: "next", to: "done", via: "speech" });

    // Both calls were live, so the yield lands on the generation's properties.
    expect(captureGenerationMock).toHaveBeenCalledTimes(2);
    expect(captureGenerationMock.mock.calls[0]?.[0]?.properties).toMatchObject({
      task_ops: 1,
      task_transitions: 0,
    });
    expect(captureGenerationMock.mock.calls[1]?.[0]?.properties).toMatchObject({
      task_ops: 1,
      task_transitions: 1,
    });

    // Rebuilt from the cache, the same batch reports the same yield.
    await clearOps(USER_ID);
    await resetCursor(USER_ID);
    await extractWorkspace(USER_ID);
    await extractWorkspace(USER_ID);
    const cached = captureMock.mock.calls.filter((c) => c[1] === "workspace_extraction_cached");
    expect(cached.map((c) => c[2]?.task_transitions)).toEqual([0, 1]);
  });

  it("does nothing when there is no new speech", async () => {
    await extractWorkspace(USER_ID);
    chatMock.mockClear();

    const outcome = await extractWorkspace(USER_ID);
    expect(outcome.skipped).toBe("nothing pending");
    expect(chatMock).not.toHaveBeenCalled();
  });
});

describeIfDb("extractWorkspace, with directions in the stream", () => {
  const DIRECTION = "Mark this as the intro's main claim.";
  const CAPABILITY_ID = "00000000-0000-4000-8000-0000000000e9";

  beforeEach(() => {
    chatMock.mockReset();
    chatMock.mockResolvedValue(reply(RESPONSE));
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  /** The classifier's verdict on a line, as recordClassifications writes it. */
  async function classifyAsDirection(utteranceId: string, handledBy: "capability" | null) {
    const db = getDb();
    if (handledBy) {
      await db
        .insert(capability)
        .values({ id: CAPABILITY_ID, userId: USER_ID, type: "action", name: "mark" })
        .onConflictDoNothing();
    }
    await db.insert(directive).values({
      utteranceId,
      captureSessionId: SESSION_ID,
      verb: "mark",
      restatement: "Marking that.",
      capabilityId: handledBy ? CAPABILITY_ID : null,
      confidence: 90,
    });
  }

  /**
   * The classifier's prompt promises a direction "drops out of the workspace".
   * Kept for a direction a capability already carried out: never shown to the
   * model, never cited by an op, and still consumed, so it is not waited on.
   */
  it("never sends a handled direction to the model, and moves past it", async () => {
    const rows = await seedTranscript([
      ...LINES.slice(0, 3),
      { text: DIRECTION, kind: "directive" },
      ...LINES.slice(3, 7),
    ]);
    const directionId = rows.find((r) => r.text === DIRECTION)!.id;
    await classifyAsDirection(directionId, "capability");

    const outcome = await extractWorkspace(USER_ID);

    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(sentOnCall()).not.toContain(DIRECTION);
    expect(sentOnCall()).toContain(LINES[0]);
    expect(outcome.segments).toBe(8); // the whole batch was consumed

    const ops = await loadOps(USER_ID);
    expect(ops.flatMap((o) => o.sourceUtteranceIds)).not.toContain(directionId);
    const [stored] = await loadExtractions(USER_ID);
    expect(stored?.inputSegmentIds).not.toContain(directionId);

    expect((await extractWorkspace(USER_ID)).skipped).toBe("nothing pending");
  });

  /**
   * 15 Sep 2026: "Let's remove this asymmetry already" was a direction no
   * capability handles. Withheld, the card it named stayed on the board. An
   * unhandled direction about the person's own work is speech the extractor
   * is written to act on.
   */
  it("sends a direction nothing handles, so speech can still drop a task", async () => {
    const REMOVE = "Let's remove this asymmetry already.";
    const rows = await seedTranscript([...LINES.slice(0, 7), { text: REMOVE, kind: "directive" }]);
    await classifyAsDirection(rows.find((r) => r.text === REMOVE)!.id, null);

    await extractWorkspace(USER_ID);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(sentOnCall()).toContain(REMOVE);
  });

  it("withholds a line a person marked as a direction by hand", async () => {
    const rows = await seedTranscript([...LINES.slice(0, 7), DIRECTION]);
    await getDb()
      .update(utterance)
      .set({ kindOverride: "directive" })
      .where(eq(utterance.id, rows.find((r) => r.text === DIRECTION)!.id));

    await extractWorkspace(USER_ID);
    expect(sentOnCall()).not.toContain(DIRECTION);
  });

  it("calls no model for a batch that is all handled directions", async () => {
    const rows = await seedTranscript(LINES.map((_, i) => ({ text: `${DIRECTION} ${i}`, kind: "directive" as const })));
    for (const row of rows) await classifyAsDirection(row.id, "capability");
    const outcome = await extractWorkspace(USER_ID);
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.opsAppended).toBe(0);
    expect((await extractWorkspace(USER_ID)).skipped).toBe("nothing pending");
  });

  /**
   * The race T0.4 closes. A line the classifier has not reached yet may be a
   * direction, so the batch waits — without moving the cursor, so the same
   * eight lines are taken when it resumes. Past the wait, the line is content.
   */
  it("waits for an unclassified line, then sends it as content after the timeout", async () => {
    await seedTranscript([...LINES.slice(0, 7), { text: DIRECTION, kind: "unclassified" }]);

    const early = await extractWorkspace(USER_ID);
    expect(early.skipped).toBe("awaiting classification");
    expect(chatMock).not.toHaveBeenCalled();

    const later = new Date(Date.now() + CLASSIFY_WAIT_MS + 1_000);
    const outcome = await extractWorkspace(USER_ID, later);
    expect(outcome.segments).toBe(8);
    expect(chatMock).toHaveBeenCalledTimes(1);
    expect(sentOnCall()).toContain(DIRECTION);
  });

  it("does not wait on a line the classifier has already settled", async () => {
    await seedTranscript([...LINES.slice(0, 7), { text: DIRECTION, kind: "directive" }]);
    const outcome = await extractWorkspace(USER_ID);
    expect(outcome.skipped).toBeUndefined();
    expect(chatMock).toHaveBeenCalledTimes(1);
  });
});
