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
import {
  artifact,
  audioChunk,
  captureSession,
  directive,
  macroProposal,
  user,
  utterance,
  workspaceOp,
} from "./schema";

const CHUNK_MS = 10_000;
const MIME = "audio/wav";

/** A fixed, deterministic session id so re-running replaces rather than piles up. */
const FIXTURE_SESSION_ID = "00000000-0000-4000-8000-00000000f1a7";

/**
 * Two earlier sessions, so the derived views have a shape rather than a point.
 *
 * `/trajectory` needs several moments to draw a trajectory at all, and the
 * macro detector needs a pattern spanning more than one session before it will
 * propose anything — so a single fixture drive leaves both looking broken when
 * they are working correctly.
 */
const EARLIER_SESSION_IDS = [
  "00000000-0000-4000-8000-00000000f1a5",
  "00000000-0000-4000-8000-00000000f1a6",
] as const;

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

/**
 * Speech from earlier drives, with the workspace ops it would have produced.
 *
 * Ops are written directly rather than extracted, because extraction needs a
 * model and the whole point of the fixture is that it does not. They carry the
 * same shape a real extraction produces — a topic created, blocks added, one
 * claim superseding another — so the fold, the diff and the trajectory all
 * exercise their real paths.
 */
const EARLIER: {
  session: (typeof EARLIER_SESSION_IDS)[number];
  daysAgo: number;
  setting: "driving" | "walking" | "hands_busy" | "desk";
  lines: { text: string; kind: "content" | "directive" }[];
  ops: { type: "create_topic" | "add_block" | "revise_block"; payload: Record<string, unknown> }[];
}[] = [
  {
    session: EARLIER_SESSION_IDS[0],
    daysAgo: 9,
    setting: "driving",
    lines: [
      { text: "The thing I want out of the research stay is not the name of the place.", kind: "content" },
      { text: "Flag the funding question, I keep forgetting it.", kind: "directive" },
      { text: "Three to six months feels right, any less and nothing lands.", kind: "content" },
    ],
    ops: [
      { type: "create_topic", payload: { topicId: "fx-stay", title: "Research stay", slug: "research-stay", icon: "Plane" } },
      { type: "add_block", payload: { blockId: "fx-b1", topicId: "fx-stay", kind: "claim", text: "What matters is not the name of the place.", spans: [] } },
      { type: "add_block", payload: { blockId: "fx-b2", topicId: "fx-stay", kind: "fact", label: "Duration", text: "Three to six months.", spans: [] } },
    ],
  },
  {
    session: EARLIER_SESSION_IDS[1],
    daysAgo: 4,
    setting: "walking",
    lines: [
      { text: "Actually what matters is who I would be working with, day to day.", kind: "content" },
      { text: "Flag the funding thing again, it is still open.", kind: "directive" },
      { text: "The ethics form needs a data management plan before any of this.", kind: "content" },
    ],
    ops: [
      { type: "revise_block", payload: { blockId: "fx-b3", supersedesBlockId: "fx-b1", topicId: "fx-stay", kind: "claim", text: "What matters is who I would work with, day to day.", spans: [] } },
      { type: "create_topic", payload: { topicId: "fx-ethics", title: "Ethics form", slug: "ethics-form", icon: "Scale" } },
      { type: "add_block", payload: { blockId: "fx-b4", topicId: "fx-ethics", kind: "question", text: "Does the data management plan have to name the outlet?", spans: [] } },
    ],
  },
];

export async function seedFixtureSession(userId: string): Promise<void> {
  const db = getDb();

  // Replace any prior fixture so re-running is idempotent. Chunks, utterances
  // and artefacts cascade from the session.
  await db.delete(captureSession).where(eq(captureSession.id, FIXTURE_SESSION_ID));
  for (const id of EARLIER_SESSION_IDS) {
    await db.delete(captureSession).where(eq(captureSession.id, id));
  }
  // Ops do not cascade from a session — `capture_session_id` is `set null`, so
  // they would survive as orphans and double on every re-run.
  await db.delete(workspaceOp).where(eq(workspaceOp.userId, userId));
  // Proposals hang off the user rather than a session, so they too would
  // survive a re-seed — and the unique (user, form) index would then reject the
  // replacement silently.
  await db.delete(macroProposal).where(eq(macroProposal.userId, userId));

  await seedEarlierSessions(userId);

  const startedAt = new Date(Date.now() - 60 * 60 * 1000);

  await db.insert(captureSession).values({
    id: FIXTURE_SESSION_ID,
    userId,
    startedAt,
    endedAt: new Date(startedAt.getTime() + SCRIPT.length * CHUNK_MS),
    // `hands_busy` rather than `driving`, so the cue panel is visible on
    // `/record` for anyone looking at the fixture without a car.
    setting: "hands_busy",
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

    const [row] = await db
      .insert(utterance)
      .values({
        captureSessionId: FIXTURE_SESSION_ID,
        chunkId: chunk.id,
        // Sits 1s into the chunk, so seeking is visibly distinct from the boundary.
        startOffsetMs: startOffsetMs + 1000,
        endOffsetMs: startOffsetMs + CHUNK_MS - 1500,
        text: line.text,
        kind: line.kind,
      })
      .returning({ id: utterance.id });

    if (row && line.kind === "directive") {
      await db.insert(directive).values({
        utteranceId: row.id,
        captureSessionId: FIXTURE_SESSION_ID,
        verb: verbOf(line.text),
        object: objectOf(line.text),
        restatement: line.text,
        confidence: 85,
      });
    }
  }

  await seedMacroProposal(userId);
}

/** The two earlier drives, their transcripts, and the ops they produced. */
async function seedEarlierSessions(userId: string): Promise<void> {
  const db = getDb();

  for (const drive of EARLIER) {
    const startedAt = new Date(Date.now() - drive.daysAgo * 24 * 60 * 60 * 1000);

    await db.insert(captureSession).values({
      id: drive.session,
      userId,
      startedAt,
      endedAt: new Date(startedAt.getTime() + drive.lines.length * CHUNK_MS),
      setting: drive.setting,
      deviceInfo: { fixture: true },
    });

    for (const [index, line] of drive.lines.entries()) {
      const startOffsetMs = index * CHUNK_MS;
      const [chunk] = await db
        .insert(audioChunk)
        .values({
          captureSessionId: drive.session,
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

      if (!chunk) throw new Error("Failed to insert fixture chunk");

      const [row] = await db
        .insert(utterance)
        .values({
          captureSessionId: drive.session,
          chunkId: chunk.id,
          startOffsetMs: startOffsetMs + 1000,
          endOffsetMs: startOffsetMs + CHUNK_MS - 1500,
          text: line.text,
          kind: line.kind,
        })
        .returning({ id: utterance.id });

      if (row && line.kind === "directive") {
        await db.insert(directive).values({
          utteranceId: row.id,
          captureSessionId: drive.session,
          verb: verbOf(line.text),
          object: objectOf(line.text),
          restatement: line.text,
          confidence: 80,
        });
      }
    }

    // `seq` is a bigserial: Postgres assigns the total order, and the fold
    // sorts by it, so inserting in script order is what makes the fixture
    // deterministic.
    for (const [index, op] of drive.ops.entries()) {
      await db.insert(workspaceOp).values({
        userId,
        captureSessionId: drive.session,
        type: op.type,
        payload: op.payload,
        occurredAt: new Date(startedAt.getTime() + (index + 1) * CHUNK_MS),
        sourceUtteranceIds: [],
      });
    }
  }
}

/**
 * A macro proposal, as the detector would have produced one.
 *
 * Seeded directly because inducing it needs a `reasoning` call, and the point
 * of the fixture is to work without a model. The shape is exactly what
 * `detect-macros.ts` writes — including the replay artefact, which is the
 * verification story: the proposal run against the speech that triggered it, so
 * the person hears the effect rather than reading the definition.
 */
async function seedMacroProposal(userId: string): Promise<void> {
  const db = getDb();

  const flags = await db
    .select({
      utteranceId: directive.utteranceId,
      captureSessionId: directive.captureSessionId,
      restatement: directive.restatement,
      createdAt: directive.createdAt,
    })
    .from(directive)
    .where(eq(directive.verb, "flag"));

  if (flags.length === 0) return;

  const body = [
    "Pulls together everything you flagged as still open.",
    "",
    ...flags.map((f) => `- ${f.restatement}`),
  ].join("\n");

  const [replay] = await db
    .insert(artifact)
    .values({
      captureSessionId: flags[0]!.captureSessionId,
      kind: "replay_preview",
      title: "If this had been running: flag|open",
      body,
      spans: flags.map((f) => ({
        utteranceId: f.utteranceId,
        startChar: 0,
        endChar: f.restatement.length,
      })),
    })
    .returning({ id: artifact.id });

  await db.insert(macroProposal).values({
    userId,
    canonicalForm: "flag|open",
    occurrences: flags.map((f) => ({
      utteranceId: f.utteranceId,
      captureSessionId: f.captureSessionId,
      text: f.restatement,
      occurredAt: f.createdAt.toISOString(),
    })),
    sessionCount: new Set(flags.map((f) => f.captureSessionId)).size,
    proposedName: "open",
    restatement: "Pulls together everything you flagged as still open.",
    markdown:
      "# open\n\nCollect everything flagged as unresolved into one list.\n\n" +
      "## Behaviour\n- Quote each flagged line verbatim; never paraphrase.\n" +
      "- Keep the order they were said in.\n- Additive and reversible: fire on weak evidence.\n",
    params: { reversible: true, confirm: false },
    replayArtifactId: replay?.id ?? null,
  });
}

/**
 * The verb the classifier would have named, without asking a model.
 *
 * Skips the same leading filler the real gate does — "And flag the bit…" is a
 * flag, not an "and" — so the fixture shows what the pipeline actually
 * produces rather than something that looks like a bug in it.
 */
function verbOf(text: string): string {
  const filler = new Set(["and", "so", "ok", "okay", "right", "well", "just", "then", "actually"]);
  const words = text.toLowerCase().replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/);
  const verb = words.find((word) => word.length > 0 && !filler.has(word)) ?? "";
  return verb === "make" ? "name" : verb;
}

/** Everything after the verb, kept short. */
function objectOf(text: string): string {
  return text.split(/\s+/).slice(1, 6).join(" ").replace(/[.,]$/, "");
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
  const earlierLines = EARLIER.reduce((n, d) => n + d.lines.length, 0);
  const earlierOps = EARLIER.reduce((n, d) => n + d.ops.length, 0);
  console.log(
    `Fixtures seeded for ${firstUser.email}: ` +
      `${EARLIER.length + 1} sessions, ${SCRIPT.length + earlierLines} utterances, ` +
      `${earlierOps} workspace ops.`,
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
