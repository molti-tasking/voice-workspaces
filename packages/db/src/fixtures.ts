/**
 * Fixture session.
 *
 * Lets anyone work on the pipeline and the Workspace without driving anywhere,
 * and without a configured LiteLLM key: it writes chunks already marked
 * `transcribed` plus the utterances that would have come from them.
 *
 * The audio is a synthesised tone rather than speech, so playback and offset
 * seeking are exercisable end to end even though the words are fabricated.
 *
 *   pnpm db:fixtures
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { chunkKey, fingerprint, getStorage } from "@voicemural/shared/storage";
import { closeDb, getDb } from "./index";
import { audioChunk, captureSession, user, utterance } from "./schema";

const CHUNK_MS = 10_000;
const SAMPLE_RATE = 16_000;
const MIME = "audio/wav";

/** A fixed, deterministic session id so re-running replaces rather than piles up. */
const FIXTURE_SESSION_ID = "00000000-0000-4000-8000-00000000f1a7";

/**
 * Minimal 16-bit mono PCM WAV. Written by hand so the fixture needs no ffmpeg
 * and no binary committed to the repo.
 */
function synthesiseWav(durationMs: number, frequencyHz: number): Uint8Array {
  const samples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // PCM header size
  buffer.writeUInt16LE(1, 20); // format = PCM
  buffer.writeUInt16LE(1, 22); // channels
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples; i += 1) {
    // Quiet, and faded at the edges so scrubbing between chunks is not jarring.
    const t = i / SAMPLE_RATE;
    const fade = Math.min(1, Math.min(t, durationMs / 1000 - t) * 4);
    const value = Math.sin(2 * Math.PI * frequencyHz * t) * 0.15 * Math.max(0, fade);
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }

  return new Uint8Array(buffer);
}

/** Plausible commute monologue, mixing content with the occasional directive. */
const SCRIPT: { text: string; kind: "content" | "directive" | "unclassified" }[] = [
  { text: "Right, so the thing I keep circling back to is the Midas touch problem.", kind: "content" },
  { text: "If everything I say is content by default, the failure mode is additive, not destructive.", kind: "content" },
  { text: "Mark that.", kind: "directive" },
  { text: "Because the alternative is a classifier arms race, and that never converges.", kind: "content" },
  { text: "What Niklas said about watertight seals between projects — that applies here too.", kind: "content" },
  { text: "The repertoire is the contribution, not the recogniser.", kind: "content" },
  { text: "Make that a thing, call it the asymmetry argument.", kind: "directive" },
  { text: "Actually no, the interesting claim is that you cannot specify the repertoire in advance.", kind: "content" },
  { text: "You only find out what you need after you have needed it a few times.", kind: "content" },
  { text: "Which is exactly why the growth curve is the measurement and not the feature list.", kind: "content" },
  { text: "Summarise this into the diary when I get in.", kind: "directive" },
  { text: "And flag the bit about specification in advance, that is the abstract.", kind: "directive" },
];

export async function seedFixtureSession(userId: string): Promise<void> {
  const db = getDb();
  const storage = getStorage();

  // Replace any prior fixture so re-running is idempotent. Chunks, utterances
  // and artefacts cascade from the session.
  await db.delete(captureSession).where(eq(captureSession.id, FIXTURE_SESSION_ID));

  const startedAt = new Date(Date.now() - 60 * 60 * 1000);

  await db.insert(captureSession).values({
    id: FIXTURE_SESSION_ID,
    userId,
    startedAt,
    endedAt: new Date(startedAt.getTime() + SCRIPT.length * CHUNK_MS),
    deviceInfo: { fixture: true, note: "Synthesised by pnpm db:fixtures" },
  });

  for (const [index, line] of SCRIPT.entries()) {
    const startOffsetMs = index * CHUNK_MS;
    // Vary the pitch per chunk so it is audible which chunk is playing.
    const audio = synthesiseWav(CHUNK_MS, 220 + index * 20);
    const key = chunkKey(FIXTURE_SESSION_ID, index, "wav");
    await storage.put(key, audio);

    const [chunk] = await db
      .insert(audioChunk)
      .values({
        captureSessionId: FIXTURE_SESSION_ID,
        seq: index,
        startOffsetMs,
        durationMs: CHUNK_MS,
        mimeType: MIME,
        byteSize: audio.byteLength,
        checksum: fingerprint(audio),
        storageKey: key,
        status: "transcribed",
        transcribedAt: new Date(),
      })
      .returning({ id: audioChunk.id });

    if (!chunk) throw new Error(`Failed to insert fixture chunk ${index}`);

    await db.insert(utterance).values({
      captureSessionId: FIXTURE_SESSION_ID,
      chunkId: chunk.id,
      // Sits 1s into the chunk, so seeking is visibly distinct from the boundary.
      startOffsetMs: startOffsetMs + 1000,
      endOffsetMs: startOffsetMs + CHUNK_MS - 1500,
      text: line.text,
      kind: line.kind,
    });
  }
}

async function main() {
  const { config } = await import("dotenv");
  config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

  const db = getDb();
  const [firstUser] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .limit(1);

  if (!firstUser) {
    console.log("No users yet. Sign in with GitHub at http://localhost:3000 first.");
    return;
  }

  await seedFixtureSession(firstUser.id);
  console.log(
    `Fixture session seeded for ${firstUser.email}: ` +
      `${SCRIPT.length} chunks, ${SCRIPT.length} utterances, synthesised audio.`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  main()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
