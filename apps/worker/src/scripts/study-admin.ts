/**
 * The field study's researcher controls.
 *
 *   pnpm study:export [--user <id>] [--out <dir>]        one JSONL file per participant
 *   pnpm study:export --user <id> --include-text          pilot accounts only; see below
 *   pnpm study:metrics [--user <id>] [--out <dir>] [--tz Europe/Berlin]  the four measure groups, per drive and participant
 *   pnpm study:metrics --print                            the same, to stdout
 *   pnpm study:review --user <id> [--card <id> --outcome done|open|lost]   the day-7 review
 *   pnpm study:participant --user <id> --id <P07>         assign a pseudonym (or --clear)
 *   pnpm study:condition --user <id> --set '<json>'       the condition for their NEXT drives (or --clear)
 *   pnpm study:condition --user <id>                      print the template and recent drives
 *
 * WHY SETTERS AT ALL, when `board_enabled_at` is set with SQL. A condition is
 * JSON, and a hand-written JSON typo in `user.study_condition` does not fail:
 * the recorder registers the drive under the defaults, so a participant spends
 * a phase in the wrong arm and nobody finds out until the analysis. These
 * commands validate against `StudyCondition` before writing anything.
 *
 * `export` without `--user` covers everyone with a participant id. Its output
 * carries no transcript, agent or workspace text (apps/worker/src/study/export.ts).
 * `--include-text` is refused unless `--user` is listed in STUDY_PILOT_USER_IDS
 * (comma-separated) — the researcher's own pilot account, where reading the
 * words is the point.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { closeDb, desc, eq, getDb } from "@voicemural/db";
import { captureSession, user } from "@voicemural/db/schema";
import { StudyCondition } from "@voicemural/shared";
import { exportParticipant, studyParticipants } from "../study/export";
import { participantMetrics } from "../study/metrics";
import { pendingReview, recordReview } from "../study/review";

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function requireUser(userId: string | undefined): Promise<string> {
  if (!userId) throw new Error("needs --user <id>");
  const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
  if (!row) throw new Error(`no user ${userId}`);
  return row.id;
}

async function runExport(): Promise<void> {
  const userId = flag("user");
  const includeText = has("include-text");
  // Under the repo's gitignored `storage/` by default: pnpm runs this from
  // apps/worker, and an export written into the source tree is one `git add .`
  // away from a commit.
  const outDir = flag("out")
    ? resolve(flag("out")!)
    : new URL("../../../../storage/study-export", import.meta.url).pathname;

  if (includeText) {
    const pilots = (process.env.STUDY_PILOT_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!userId || !pilots.includes(userId)) {
      throw new Error(
        "--include-text exports what participants were promised nobody reads. " +
          "It needs --user, and that user must be listed in STUDY_PILOT_USER_IDS.",
      );
    }
    console.warn(
      `⚠ Exporting TRANSCRIPT AND AGENT TEXT for pilot account ${userId}. ` +
        "Never run this against a participant, and do not share the file.",
    );
  }

  const targets = userId
    ? [{ userId: await requireUser(userId), participantId: undefined as string | undefined }]
    : await studyParticipants();
  if (targets.length === 0) {
    console.log("no users have a study_participant_id; set one with pnpm study:participant");
    return;
  }

  await mkdir(outDir, { recursive: true });
  for (const target of targets) {
    const records = await exportParticipant(target.userId, { includeText });
    const participantId =
      target.participantId ?? (records[0]?.participantId as string | null | undefined) ?? null;
    const name = `${participantId ?? target.userId}${includeText ? ".with-text" : ""}.jsonl`;
    const file = join(outDir, name);
    await writeFile(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`${file}  ${records.length} records`);
  }
}

async function runParticipant(): Promise<void> {
  const userId = await requireUser(flag("user"));
  const id = has("clear") ? null : flag("id");
  if (id === undefined) throw new Error("needs --id <pseudonym> or --clear");
  if (id !== null && !/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
    throw new Error("a participant id is a short pseudonym: letters, digits, - and _ only");
  }
  await getDb().update(user).set({ studyParticipantId: id }).where(eq(user.id, userId));
  console.log(`${userId}  study_participant_id=${id ?? "(none)"}`);
}

async function runCondition(): Promise<void> {
  const userId = await requireUser(flag("user"));
  const db = getDb();

  if (has("clear") || flag("set") !== undefined) {
    let template: Record<string, unknown> | null = null;
    if (!has("clear")) {
      let raw: unknown;
      try {
        raw = JSON.parse(flag("set")!);
      } catch {
        throw new Error("--set needs a JSON object, e.g. --set '{\"agendaOffers\":true}'");
      }
      const parsed = StudyCondition.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`not a StudyCondition: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      }
      // The sparse template is stored as written; each drive stores it resolved.
      template = raw as Record<string, unknown>;
    }
    await db.update(user).set({ studyCondition: template }).where(eq(user.id, userId));
    console.log(`${userId}  next drives run under ${JSON.stringify(StudyCondition.parse(template ?? {}))}`);
    return;
  }

  const [row] = await db
    .select({ studyCondition: user.studyCondition })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  console.log(`template  ${JSON.stringify(row?.studyCondition ?? null)}`);
  const recent = await db
    .select({ id: captureSession.id, startedAt: captureSession.startedAt, studyCondition: captureSession.studyCondition })
    .from(captureSession)
    .where(eq(captureSession.userId, userId))
    .orderBy(desc(captureSession.startedAt))
    .limit(10);
  for (const s of recent) {
    console.log(`${s.startedAt.toISOString()}  ${s.id}  ${JSON.stringify(s.studyCondition)}`);
  }
}

/**
 * The measures, per session and per participant.
 *
 * SEPARATE FROM `export`, deliberately. The export is the raw record —
 * everything, one line per row, reproducible months later. This is the
 * computed answer, and it has to be re-runnable against the same export when a
 * definition changes (the re-prompt threshold is the obvious one) without
 * re-reading a database that has moved on. So: same data, two files, and
 * `metricsVersion` on every one of them.
 *
 * No `--include-text` here and no equivalent. The metrics module reads
 * transcript text to classify repeat requests and corrections, inside the
 * privacy boundary, and returns counts; there is no mode in which words come
 * out of it.
 */
async function runMetrics(): Promise<void> {
  const userId = flag("user");
  const outDir = flag("out")
    ? resolve(flag("out")!)
    : new URL("../../../../storage/study-metrics", import.meta.url).pathname;
  const rePromptAfterMs = flag("re-prompt-ms") ? Number(flag("re-prompt-ms")) : undefined;
  if (rePromptAfterMs !== undefined && !Number.isFinite(rePromptAfterMs)) {
    throw new Error("--re-prompt-ms needs a number of milliseconds");
  }

  const targets = userId
    ? [{ userId: await requireUser(userId), participantId: undefined as string | undefined }]
    : await studyParticipants();
  if (targets.length === 0) {
    console.log("no users have a study_participant_id; set one with pnpm study:participant");
    return;
  }

  const print = has("print");
  if (!print) await mkdir(outDir, { recursive: true });

  for (const target of targets) {
    const metrics = await participantMetrics(target.userId, {
      rePromptAfterMs,
      timeZone: flag("tz"),
    });
    if (print) {
      console.log(JSON.stringify(metrics, null, 2));
      continue;
    }
    const name = `${metrics.participantId ?? target.userId}.metrics.json`;
    const file = join(outDir, name);
    await writeFile(file, JSON.stringify(metrics, null, 2) + "\n");
    console.log(
      `${file}  ${metrics.sessions.length} session(s)` +
        `  unanswered-answers=${metrics.tier2.unansweredAnswers}` +
        `  lost-rate=${format(metrics.tier3.day7.lostRate)}`,
    );
  }
}

function format(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2);
}

/**
 * The day-7 review: read each item back, record done / open / lost.
 *
 * A command rather than a screen, for now, because the review is conducted BY
 * the researcher with the participant present — it is the session where the
 * system reads each item back — and a CLI that prints one card at a time is
 * closer to that than a page nobody is looking at. The API route
 * (`/api/study/review`) takes the same verdicts, so a voice review can write
 * them later without this changing.
 *
 * `--card`/`--outcome` records one verdict. Without them it prints what is
 * still waiting for a verdict, oldest first.
 */
async function runReview(): Promise<void> {
  const userId = await requireUser(flag("user"));
  const card = flag("card");
  const outcome = flag("outcome");

  if (card || outcome) {
    if (!card || !outcome) throw new Error("--card and --outcome go together");
    if (!["done", "open", "lost"].includes(outcome)) {
      throw new Error("--outcome is done, open or lost");
    }
    await recordReview(userId, card, outcome as "done" | "open" | "lost");
    console.log(`${card}  ${outcome}`);
    return;
  }

  const pending = await pendingReview(userId);
  if (pending.length === 0) {
    console.log("every card on this board has a day-7 verdict");
    return;
  }
  console.log(`${pending.length} card(s) awaiting a verdict:`);
  for (const item of pending) {
    console.log(
      `  ${item.cardId}  ${item.state}  last touched ${item.lastTouchedAt.toISOString().slice(0, 10)}`,
    );
  }
  console.log("\nrecord one with: pnpm study:review --user <id> --card <cardId> --outcome done|open|lost");
}

async function main(): Promise<void> {
  switch (process.argv[2]) {
    case "export":
      return runExport();
    case "metrics":
      return runMetrics();
    case "review":
      return runReview();
    case "participant":
      return runParticipant();
    case "condition":
      return runCondition();
    default:
      throw new Error(
        "usage: study-admin <export|metrics|review|participant|condition> [--user <id>] …",
      );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
