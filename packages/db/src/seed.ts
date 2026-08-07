/**
 * Seed the starter repertoire.
 *
 * Drawn from recurring needs in the first author's own driving sessions
 * (Notes.md:45-52); it doubles as the paper's walkthrough. Idempotent, so it is
 * safe to re-run and safe to call on first sign-in.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, getDb } from "./index";
import { capability, capabilityOrigin, capabilityVersion, user } from "./schema";
import { and, eq } from "drizzle-orm";

interface StarterCapability {
  type: "mode" | "persona" | "action" | "rule";
  name: string;
  restatement: string;
  params: Record<string, unknown>;
  markdown: string;
}

export const STARTER_REPERTOIRE: StarterCapability[] = [
  {
    type: "action",
    name: "mark",
    restatement: "Flags the idea you just described so it survives the session.",
    params: { reversible: true, confirm: false },
    markdown: `# mark

Flag an idea so it survives the session.

Highest frequency, safest to over-trigger. Because it is additive and
reversible, fire on weak evidence — a false positive costs one stray marker,
a false negative loses the thought.

## Behaviour
- Attach a marker to the utterance range that prompted it.
- Do not interrupt. Acknowledge with a short tone or nothing at all.
- Never confirm before firing.
`,
  },
  {
    type: "action",
    name: "diary",
    restatement: "Renders this session as a dated entry in your usual structure.",
    params: {
      reversible: true,
      confirm: false,
      structure: ["Date", "What I was thinking about", "Open questions", "Marked ideas"],
    },
    markdown: `# diary

Render the session as a dated entry in a fixed structure.

## Structure
1. **Date** — the session date.
2. **What I was thinking about** — two or three sentences of substance.
3. **Open questions** — anything left unresolved.
4. **Marked ideas** — everything \`mark\` flagged, verbatim.

## Provenance
Every derived sentence must carry a span back to the utterances it came from.
Never paraphrase a marked idea; quote it.
`,
  },
  {
    type: "action",
    name: "to-doc",
    restatement: "Appends the entry to your nominated document. Asks first.",
    params: { reversible: false, confirm: true, outlet: "default" },
    markdown: `# to-doc

Append the entry to a nominated document.

## Behaviour
- Outbound and irreversible, so **always confirm before firing**.
- Confirmation may be deferred to a pause or to the end of the drive; do not
  demand an answer while the user is mid-thought.
- On failure, keep the artefact and retry later. Never drop it silently.
`,
  },
  {
    type: "mode",
    name: "interview",
    restatement: "Asks you one question at a time, and summarises when you finish.",
    params: {
      oneQuestionAtATime: true,
      immediateFeedback: false,
      silenceBeforePromptMs: 4000,
      exitRule: "diary",
    },
    markdown: `# interview

Elicit thinking by asking one question at a time.

## Turn-taking
- Ask exactly one question, then stop talking.
- Treat silence as thinking, not as a turn boundary. Wait
  \`silenceBeforePromptMs\` before offering a gentle prompt.
- Never stack two questions in one turn.

## Parameters
- \`immediateFeedback\` — when off, withhold reactions until the user pauses.
  The same mode with feedback on is coaching; this is one capability with a
  parameter, not two capabilities.

## Exit
On session end, call \`diary\`.
`,
  },
  {
    type: "persona",
    name: "supportive",
    restatement: "Warm and encouraging, and it builds on what you say.",
    params: { warmth: "high", challenge: "low" },
    markdown: `# supportive

Register and content of the system's turns.

- Build on what the user said rather than redirecting it.
- Reflect the strongest version of a half-formed idea back to them.
- Never flatter. Encouragement that is not specific reads as noise.

Composed with \`interview\`, this is coaching.
`,
  },
  {
    type: "persona",
    name: "sceptical",
    restatement: "Pushes back and looks for the weak link in your reasoning.",
    params: { warmth: "low", challenge: "high" },
    markdown: `# sceptical

Register and content of the system's turns.

- Look for the weakest link and name it plainly.
- Ask what would have to be true for the claim to fail.
- Challenge the argument, never the person.

Composed with \`interview\`, this is a viva.
`,
  },
  {
    type: "rule",
    name: "on-session-end-summarise",
    restatement: "When a drive ends, it writes the diary entry automatically.",
    params: { event: "session.end", action: "diary" },
    markdown: `# on session end, summarise

Bind \`diary\` to the end of a session.

This resolves the disposition of the many sessions that end without any
instruction — the common case, since a drive usually ends by arriving
somewhere rather than by deciding to stop.
`,
  },
];

/** Install the starter repertoire for a user. Idempotent. */
export async function seedStarterRepertoire(userId: string): Promise<number> {
  const db = getDb();
  let installed = 0;

  for (const starter of STARTER_REPERTOIRE) {
    const existing = await db
      .select({ id: capability.id })
      .from(capability)
      .where(and(eq(capability.userId, userId), eq(capability.name, starter.name)))
      .limit(1);

    if (existing.length > 0) continue;

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(capability)
        .values({ userId, type: starter.type, name: starter.name })
        .returning({ id: capability.id });

      if (!created) throw new Error(`Failed to insert capability ${starter.name}`);

      await tx.insert(capabilityVersion).values({
        capabilityId: created.id,
        version: 1,
        markdown: starter.markdown,
        params: starter.params,
        restatement: starter.restatement,
      });

      await tx.insert(capabilityOrigin).values({
        capabilityId: created.id,
        createdVia: "starter",
        note: "Seeded starter repertoire (Notes.md:45-52)",
      });
    });

    installed += 1;
  }

  return installed;
}

async function main() {
  // Only when run as a script; the web app already has env loaded by Next.
  const { config } = await import("dotenv");
  config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

  const db = getDb();
  const users = await db.select({ id: user.id, email: user.email }).from(user);

  if (users.length === 0) {
    console.log(
      "No users yet. Sign in with GitHub at http://localhost:3000 first —\n" +
        "the starter repertoire is installed automatically on first sign-in.",
    );
    return;
  }

  for (const u of users) {
    const n = await seedStarterRepertoire(u.id);
    console.log(`${u.email}: installed ${n} capability(ies)`);
  }
}

// Only run when invoked directly, not when imported by the web app (which
// calls seedStarterRepertoire on first sign-in).
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
