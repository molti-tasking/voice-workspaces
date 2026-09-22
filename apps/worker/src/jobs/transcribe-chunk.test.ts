/**
 * How the chunk job classifies a permanent transcription failure.
 *
 * The claim under test is narrow: when the model call reports an undecodable
 * payload, the chunk is marked failed and NOT retried, and the rest of the
 * drive is untouched. A single drive of truncated payloads was what a day's
 * transcription-failure spike turned out to be. The floor itself lives in
 * `transcribeChunk` and is covered by the llm package's own tests.
 *
 * The model is mocked. Needs the local Postgres; skipped when it is unreachable.
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

const { UndecodableAudioError } = await import("@voicemural/llm");
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
    .select({ status: audioChunk.status })
    .from(audioChunk)
    .where(eq(audioChunk.id, CHUNK_ID));
  return row;
}

describeIfDb("handleTranscribeChunk failure classification", () => {
  beforeEach(() => {
    transcribeMock.mockReset();
    captureMock.mockReset();
  });

  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID]));
    await closeDb();
  });

  it("fails an undecodable chunk permanently, never retried", async () => {
    await seedChunk(new Uint8Array(256));
    transcribeMock.mockRejectedValue(new UndecodableAudioError(5));

    await handleTranscribeChunk(CHUNK_ID);

    const row = await chunkStatus();
    expect(row?.status).toBe("failed");

    const [, event, props] = captureMock.mock.calls.at(-1) ?? [];
    expect(event).toBe("transcription_failed");
    expect((props as { retryable: boolean }).retryable).toBe(false);
  });

  it("transcribes a chunk the model accepts", async () => {
    await seedChunk(new Uint8Array(256));
    transcribeMock.mockResolvedValue({ text: "", segments: [], degenerate: false });

    await handleTranscribeChunk(CHUNK_ID);

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    const row = await chunkStatus();
    expect(row?.status).toBe("transcribed");
  });
});
