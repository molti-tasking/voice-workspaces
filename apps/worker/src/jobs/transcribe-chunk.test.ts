/**
 * Payload validation for the chunk pipeline.
 *
 * The claim under test is narrow: a chunk whose stored audio is too small to be
 * a decodable file is failed WITHOUT a model call, and marked permanent so it
 * is never retried. A single drive of these truncated payloads was what a day's
 * transcription-failure spike turned out to be, each one burning a GPU slot to
 * be told the bytes could not be decoded.
 *
 * The model is mocked, so the call count is the assertion. Needs the local
 * Postgres; skipped when it is unreachable.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });
process.env.STORAGE_DIR = await mkdtemp(join(tmpdir(), "vm-transcribe-test-"));

const transcribeMock = vi.fn();
const captureMock = vi.fn();

vi.mock("@voicemural/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voicemural/llm")>();
  return { ...actual, transcribeChunk: transcribeMock };
});

vi.mock("@voicemural/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@voicemural/telemetry")>();
  return { ...actual, capture: captureMock };
});

const { closeDb, getDb } = await import("@voicemural/db");
const { audioChunk, captureSession, user } = await import("@voicemural/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { getStorage } = await import("@voicemural/shared/storage");
const { handleTranscribeChunk } = await import("./transcribe-chunk");

const USER_ID = "test-transcribe-user";
const SESSION_ID = "00000000-0000-4000-8000-0000000000d1";
const CHUNK_ID = "00000000-0000-4000-8000-0000000000d2";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seedChunk(bytes: Uint8Array) {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID]));
  await db.insert(user).values({ id: USER_ID, name: "T", email: `${USER_ID}@test.local` });
  await db.insert(captureSession).values({
    id: SESSION_ID,
    userId: USER_ID,
    startedAt: new Date("2026-03-01T08:00:00Z"),
    setting: "driving",
  });

  const storageKey = `sessions/${SESSION_ID}/000000.webm`;
  await getStorage().put(storageKey, bytes);
  await db.insert(audioChunk).values({
    id: CHUNK_ID,
    captureSessionId: SESSION_ID,
    seq: 0,
    startOffsetMs: 0,
    durationMs: 10_000,
    mimeType: "audio/webm",
    byteSize: bytes.byteLength,
    checksum: "x",
    storageKey,
    status: "stored",
  });
}

async function chunkStatus() {
  const [row] = await getDb()
    .select({ status: audioChunk.status, reason: audioChunk.failureReason })
    .from(audioChunk)
    .where(eq(audioChunk.id, CHUNK_ID));
  return row;
}

describeIfDb("handleTranscribeChunk payload validation", () => {
  beforeEach(() => {
    transcribeMock.mockReset();
    captureMock.mockReset();
  });

  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID]));
    await closeDb();
  });

  it("fails a too-small payload permanently, with no model call", async () => {
    // Five bytes: what the failing drive actually uploaded. No header, no frame.
    await seedChunk(new Uint8Array([1, 2, 3, 4, 5]));

    await handleTranscribeChunk(CHUNK_ID);

    expect(transcribeMock).not.toHaveBeenCalled();
    const row = await chunkStatus();
    expect(row?.status).toBe("failed");

    const [, event, props] = captureMock.mock.calls.at(-1) ?? [];
    expect(event).toBe("transcription_failed");
    expect((props as { retryable: boolean }).retryable).toBe(false);
    expect((props as { failure_kind: string }).failure_kind).toBe("permanent");
  });

  it("still transcribes a payload large enough to be audio", async () => {
    // Above the floor: the guard must not reject a genuine, if small, chunk.
    await seedChunk(new Uint8Array(256));
    transcribeMock.mockResolvedValue({ text: "", segments: [], degenerate: false });

    await handleTranscribeChunk(CHUNK_ID);

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    const row = await chunkStatus();
    expect(row?.status).toBe("transcribed");
  });
});
