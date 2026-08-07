/**
 * Fixture session.
 *
 * Lets anyone work on the pipeline and the Workspace without driving anywhere,
 * and without a configured LiteLLM key: it writes chunks already marked
 * `transcribed` plus the utterances that would have come from them.
 *
 * No audio, because a finished session has none — it is discarded once the
 * transcript is committed.
 *
 *   pnpm db:fixtures
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "./index";
import { audioChunk, captureSession, user, utterance } from "./schema";

const CHUNK_MS = 10_000;
const MIME = "audio/wav";

/** A fixed, deterministic session id so re-running replaces rather than piles up. */
const FIXTURE_SESSION_ID = "00000000-0000-4000-8000-00000000f1a7";

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

    // No audio: it is discarded once transcribed, so a fixture that mimics a
    // finished session has none either.
    const [chunk] = await db
      .insert(audioChunk)
      .values({
        captureSessionId: FIXTURE_SESSION_ID,
        seq: index,
        startOffsetMs,
        durationMs: CHUNK_MS,
        mimeType: MIME,
        byteSize: 0,
        checksum: "fixture",
        storageKey: null,
        status: "transcribed",
        transcribedAt: new Date(),
        audioDiscardedAt: new Date(),
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
      `${SCRIPT.length} chunks, ${SCRIPT.length} utterances.`,
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
