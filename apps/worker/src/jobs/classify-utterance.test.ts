/**
 * Cost and correctness tests for the content/direction split.
 *
 * The interesting claim is not "the model usually gets it right" — it is that
 * the model is barely asked. `isDirectiveCandidate` is pure and rejects the
 * overwhelming majority of speech, so a quiet recording must cost nothing at
 * all. That is only believable asserted directly, so the LLM is mocked and the
 * call count is the assertion.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const chatMock = vi.fn();

vi.mock("@voicemural/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voicemural/llm")>();
  return { ...actual, chat: chatMock };
});

const { closeDb, getDb } = await import("@voicemural/db");
const { audioChunk, capability, capabilityVersion, captureSession, user, utterance } =
  await import("@voicemural/db/schema");
const { inArray } = await import("drizzle-orm");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { unresolvedDirectives, directivesAwaitingInvocation } = await import(
  "@voicemural/db/repertoire"
);
const { classifyChunk, GATE_CONFIDENCE } = await import("./classify-utterance");

const USER_ID = "test-classify-user";
const SESSION_ID = "00000000-0000-4000-8000-0000000000c1";
const CHUNK_ID = "00000000-0000-4000-8000-0000000000c2";
const CAP_ID = "00000000-0000-4000-8000-0000000000c3";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

function reply(content: string) {
  return {
    content,
    resolvedModel: "test",
    requestedModel: "test",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    latencyMs: 1,
  };
}

async function seed(lines: string[]) {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID]));
  await db.insert(user).values({ id: USER_ID, name: "T", email: `${USER_ID}@test.local` });
  await db.insert(captureSession).values({
    id: SESSION_ID,
    userId: USER_ID,
    startedAt: new Date("2026-03-01T08:00:00Z"),
    setting: "driving",
  });
  await db.insert(audioChunk).values({
    id: CHUNK_ID,
    captureSessionId: SESSION_ID,
    seq: 0,
    startOffsetMs: 0,
    durationMs: 10_000,
    mimeType: "audio/webm",
    byteSize: 1,
    checksum: "x",
    status: "transcribed",
  });
  await db.insert(capability).values({
    id: CAP_ID,
    userId: USER_ID,
    type: "action",
    name: "mark",
  });
  await db.insert(capabilityVersion).values({
    capabilityId: CAP_ID,
    version: 1,
    markdown: "# mark",
    params: { reversible: true, confirm: false },
    restatement: "Flags the idea you just described.",
  });

  const ids: string[] = [];
  for (const [i, text] of lines.entries()) {
    const [row] = await getDb()
      .insert(utterance)
      .values({
        captureSessionId: SESSION_ID,
        chunkId: CHUNK_ID,
        startOffsetMs: i * 1000,
        endOffsetMs: i * 1000 + 900,
        text,
      })
      .returning({ id: utterance.id });
    ids.push(row!.id);
  }
  return ids;
}

describeIfDb("classifyChunk", () => {
  beforeEach(async () => {
    chatMock.mockReset();
  });

  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID]));
    await closeDb();
  });

  /**
   * The cost control, asserted. A recording of somebody thinking is almost
   * entirely content, and paying for a model verdict on every line of it would
   * make the whole feature unaffordable on an hour-long drive.
   */
  it("makes no model call at all when nothing looks like a direction", async () => {
    await seed([
      "I keep circling back to the Midas touch problem.",
      "It is not a recognition problem, it is an end-user programming one.",
      "I should remember that for the introduction.",
    ]);

    const outcome = await classifyChunk(CHUNK_ID, USER_ID);

    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.candidates).toBe(0);
    expect(outcome.written).toBe(3);
    expect(outcome.directives).toBe(0);

    const rows = await getDb()
      .select()
      .from(utterance)
      .where(inArray(utterance.captureSessionId, [SESSION_ID]));
    expect(rows.every((r) => r.kind === "content")).toBe(true);
    expect(rows.every((r) => r.kindConfidence === GATE_CONFIDENCE)).toBe(true);
  });

  it("asks only about the lines that survived the gate", async () => {
    const ids = await seed([
      "The repertoire is the contribution, not the recogniser.",
      "Mark that.",
    ]);

    chatMock.mockResolvedValue(
      reply(
        JSON.stringify({
          lines: [
            {
              id: ids[1],
              kind: "directive",
              confidence: 92,
              verb: "mark",
              object: "that",
              restatement: "Marking that.",
              capability: "mark",
            },
          ],
        }),
      ),
    );

    const outcome = await classifyChunk(CHUNK_ID, USER_ID);

    expect(chatMock).toHaveBeenCalledTimes(1);
    const [messages, options] = chatMock.mock.calls[0]!;
    expect(options).toMatchObject({ role: "fast", temperature: 0, json: true });
    // Only the candidate was sent — the content line never left the machine.
    expect(messages[1].content).toBe(`[${ids[1]}] Mark that.`);
    expect(messages[0].content).toContain("Existing capabilities: mark.");

    expect(outcome.directives).toBe(1);
    expect(outcome.written).toBe(2);

    // Resolved to the capability, so it is the invoker's work, not the macro
    // detector's.
    expect(await unresolvedDirectives(USER_ID, new Date(0))).toHaveLength(0);
    expect((await directivesAwaitingInvocation()).map((d) => d.verb)).toContain("mark");
  });

  it("records an improvised operation with no capability behind it", async () => {
    const ids = await seed(["Chase the invoice when I get in."]);

    chatMock.mockResolvedValue(
      reply(
        JSON.stringify({
          lines: [
            {
              id: ids[0],
              kind: "directive",
              confidence: 70,
              verb: "chase",
              object: "the invoice",
              restatement: "Chasing the invoice.",
            },
          ],
        }),
      ),
    );

    await classifyChunk(CHUNK_ID, USER_ID);

    const unresolved = await unresolvedDirectives(USER_ID, new Date(0));
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.verb).toBe("chase");
    expect(await directivesAwaitingInvocation()).toHaveLength(0);
  });

  /**
   * The whole chunk stays unclassified rather than half-written, so the next
   * sweep retries it. A partially filled chunk would fall out of the partial
   * index and never be looked at again.
   */
  it("leaves the chunk for the next sweep when the model returns nonsense", async () => {
    await seed(["Mark that."]);
    chatMock.mockResolvedValue(reply("I'm sorry, I can't help with that."));

    const outcome = await classifyChunk(CHUNK_ID, USER_ID);
    expect(outcome.written).toBe(0);

    const rows = await getDb()
      .select()
      .from(utterance)
      .where(inArray(utterance.captureSessionId, [SESSION_ID]));
    expect(rows[0]?.kind).toBe("unclassified");
  });

  it("does nothing, and costs nothing, on a chunk already classified", async () => {
    await seed(["I keep circling back to the Midas touch problem."]);
    await classifyChunk(CHUNK_ID, USER_ID);
    chatMock.mockReset();

    const outcome = await classifyChunk(CHUNK_ID, USER_ID);
    expect(outcome.skipped).toBe("nothing unclassified");
    expect(chatMock).not.toHaveBeenCalled();
  });
});
