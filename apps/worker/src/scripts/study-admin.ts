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
 *   pnpm study:prolific [--out <dir>]                     the Prolific study: participants.csv and probes.csv (PROLIFIC.md)
 *   pnpm study:week [--out <dir>] [--text]                the end-of-week questionnaire: week.csv (and week-texts.jsonl)
 *   pnpm study:session invite [--ref F07] [--order 0-5]   a display-study session: prints its view, task and link
 *   pnpm study:session list                               every session, how far it got, and the cells completed
 *   pnpm study:session export [--out <dir>] [--text]      sessions.csv, blocks.csv, moments.csv (and transcripts.jsonl)
 *   pnpm study:judge [--role judge] [--repeats 2] [--blind-check] [--limit n] [--langfuse] [--out <dir>]
 *                                                         the blind judge: items.jsonl, scores.csv, and key.csv apart
 *   pnpm study:judge --join [--out <dir>]                 joined.csv: the scores with the view of each item
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
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { closeDb, desc, eq, getDb } from "@voicemural/db";
import { captureSession, user } from "@voicemural/db/schema";
import { createSession, listSessions } from "@voicemural/db/study-session";
import { chat, type ModelRole } from "@voicemural/llm";
import { SESSION_CELLS, SESSION_DESIGN, StudyCondition, cellFor } from "@voicemural/shared";
import { flushLangfuse, langfuseConfig, startLangfuse, traceTurn, type Langfuse } from "@voicemural/talkback/eval/langfuse";
import { BLIND_OPTIONS, STUDY_JUDGE_VERSION } from "@voicemural/talkback/eval/study-judge";
import { exportParticipant, studyParticipants } from "../study/export";
import { participantMetrics } from "../study/metrics";
import { buildProlificExport, fromCsv, toCsv } from "../study/prolific-export";
import { pendingReview, recordReview } from "../study/review";
import { buildSessionExport } from "../study/session-export";
import { buildJudgeItems, joinScores, langfuseAllowed, loadJudgeBlocks, runJudge, type JudgeItem } from "../study/session-judge";
import { loadWeekResponses, weekRows, weekTexts } from "../study/week-survey";

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

/**
 * The Prolific study, as two CSV files. Carries the free recall text and the
 * PIDs (see prolific-export.ts), so it goes under the gitignored `storage/`
 * unless told otherwise, like `export`.
 */
async function runProlific(): Promise<void> {
  const outDir = flag("out")
    ? resolve(flag("out")!)
    : new URL("../../../../storage/prolific-export", import.meta.url).pathname;
  const { participants, probes } = await buildProlificExport();
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "participants.csv"), toCsv(participants));
  await writeFile(join(outDir, "probes.csv"), toCsv(probes));
  const done = participants.filter((p) => p.part2_completed_at !== null).length;
  console.log(`${join(outDir, "participants.csv")}  ${participants.length} participants, ${done} finished part 2`);
  console.log(`${join(outDir, "probes.csv")}  ${probes.length} probes`);
}

/**
 * The end-of-week questionnaire (`/survey/week`). The closed answers always;
 * their words only with `--text`, which is a deliberate act — see
 * week-survey.ts. Under the gitignored `storage/` unless told otherwise.
 */
async function runWeek(): Promise<void> {
  const outDir = flag("out")
    ? resolve(flag("out")!)
    : new URL("../../../../storage/week-survey", import.meta.url).pathname;
  const responses = await loadWeekResponses();
  if (responses.length === 0) {
    console.log("nobody has opened the end-of-week questionnaire yet");
    return;
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "week.csv"), toCsv(weekRows(responses)));
  const sent = responses.filter((r) => r.submittedAt !== null).length;
  console.log(`${join(outDir, "week.csv")}  ${responses.length} responses, ${sent} sent`);
  if (has("text")) {
    const file = join(outDir, "week-texts.jsonl");
    await writeFile(file, weekTexts(responses).map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`${file}  their words — do not share the file`);
  }
}

/**
 * The display study's sessions (`study_session`). `invite` makes one, in the
 * next cell in turn unless `--order` pins it, and prints the link to send;
 * whoever consents on it first takes part as a fresh guest. The base of the
 * link is `STUDY_SESSION_BASE_URL`, else `BETTER_AUTH_URL`.
 *
 * `list` ends with how many sessions each cell has completed: balance holds
 * for invites made, not for sessions finished, so a cell short of the others
 * is filled with `--order`.
 */
async function runSession(): Promise<void> {
  const sub = process.argv[3];
  if (sub === "invite") {
    const order = flag("order");
    if (order !== undefined && (!/^[0-9]+$/.test(order) || Number(order) >= SESSION_CELLS)) {
      throw new Error(`--order takes 0 to ${SESSION_CELLS - 1}`);
    }
    const { session, blocks } = await createSession({
      ref: flag("ref"),
      orderIndex: order === undefined ? undefined : Number(order),
    });
    const base = (process.env.STUDY_SESSION_BASE_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
    console.log(`${session.ref}  cell ${session.orderIndex}: ${blocks.map((b) => `${b.display}/${b.task}`).join(", ")}`);
    console.log(`${base}/study/session?code=${session.inviteCode}`);
    return;
  }
  if (sub === "list") {
    const completed = new Array<number>(SESSION_CELLS).fill(0);
    for (const { session, blocks } of await listSessions()) {
      const state = session.completedAt
        ? "complete"
        : blocks.every((b) => b.answeredAt)
          ? "answered"
          : blocks.some((b) => b.finishedAt)
            ? "talked"
            : session.consentedAt
              ? "consented"
              : session.userId
                ? "claimed"
                : "not opened";
      const restarts = blocks.reduce((n, b) => n + Math.max(0, b.attempts - 1), 0);
      const views = blocks.map((b) => `${b.display}/${b.task}`).join(", ");
      const cell = session.design === SESSION_DESIGN ? `cell ${session.orderIndex}` : `${session.design} ${session.orderIndex}`;
      console.log(`${session.ref.padEnd(8)} ${cell.padEnd(9)} ${views.padEnd(20)} ${state}${restarts ? `  (${restarts} restarted)` : ""}`);
      if (session.design === SESSION_DESIGN && session.completedAt) {
        const k = session.orderIndex % SESSION_CELLS;
        completed[k] = (completed[k] ?? 0) + 1;
      }
    }
    console.log(
      `\ncompleted per cell: ${completed.map((n, k) => `${k} ${cellFor(k).display}/${cellFor(k).task}: ${n}`).join("  ")}`,
    );
    return;
  }
  if (sub === "export") {
    // Under the gitignored `storage/`, like the other exports. Their words are
    // in it (summaries, probes, reasons; transcripts with --text): the
    // session's consent says the researchers read them, and nobody else does.
    const outDir = flag("out")
      ? resolve(flag("out")!)
      : new URL("../../../../storage/study-session", import.meta.url).pathname;
    const out = await buildSessionExport({ text: has("text") });
    await mkdir(outDir, { recursive: true });
    for (const [name, rows] of [
      ["sessions.csv", out.sessions],
      ["blocks.csv", out.blocks],
      ["moments.csv", out.moments],
    ] as const) {
      await writeFile(join(outDir, name), toCsv(rows));
      console.log(`${join(outDir, name)}  ${rows.length} rows`);
    }
    if (has("text")) {
      const file = join(outDir, "transcripts.jsonl");
      await writeFile(file, out.transcripts.map((t) => JSON.stringify(t)).join("\n") + (out.transcripts.length ? "\n" : ""));
      console.log(`${file}  ${out.transcripts.length} conversations — their words; do not share the file`);
    }
    return;
  }
  throw new Error("usage: study-admin session <invite [--ref F07] [--order 0-5] | list | export [--out <dir>] [--text]>");
}

const JUDGE_ROLES: readonly ModelRole[] = ["judge", "fast", "reasoning", "converse"];

/**
 * The display study's blind judge (session-judge.ts). Writes the key first
 * and apart (key.csv: which block each item id is), then the blinded items
 * (items.jsonl: exactly what the judge is sent), then the scores
 * (scores.csv: by item id only). `--join` is the one step that reads the key
 * with the scores, into joined.csv, and says how often the blind check named
 * the right view.
 */
async function runStudyJudge(): Promise<void> {
  const outDir = flag("out")
    ? resolve(flag("out")!)
    : new URL("../../../../storage/study-judge", import.meta.url).pathname;

  if (has("join")) {
    const scores = fromCsv(await readFile(join(outDir, "scores.csv"), "utf8"));
    const key = fromCsv(await readFile(join(outDir, "key.csv"), "utf8"));
    const joined = joinScores(scores, key);
    await writeFile(join(outDir, "joined.csv"), toCsv(joined));
    console.log(`${join(outDir, "joined.csv")}  ${joined.length} rows`);
    const blind = joined.filter((r) => r.kind === "blind" && r.guessed_right !== undefined && r.guessed_right !== null);
    if (blind.length > 0) {
      const right = blind.filter((r) => r.guessed_right === true).length;
      const chance = Math.round(100 / Object.keys(BLIND_OPTIONS).length);
      console.log(`blind check: ${right} of ${blind.length} guessed the view (${Math.round((right / blind.length) * 100)}%; chance is ${chance}%)`);
    }
    return;
  }

  const role = (flag("role") ?? "judge") as ModelRole;
  if (!JUDGE_ROLES.includes(role)) throw new Error(`--role takes ${JUDGE_ROLES.join(", ")}`);
  const repeats = Number(flag("repeats") ?? 1);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error("--repeats takes 1 to 5");
  const limit = flag("limit") === undefined ? Infinity : Number(flag("limit"));

  let salt = process.env.STUDY_JUDGE_SALT;
  if (!salt) {
    salt = randomBytes(16).toString("hex");
    console.warn("⚠ STUDY_JUDGE_SALT is not set: this run's item ids will not match another run's.");
  }

  let langfuse: Langfuse | null = null;
  if (has("langfuse")) {
    const config = langfuseConfig();
    if (!config) throw new Error("--langfuse needs LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY.");
    if (!langfuseAllowed(config)) {
      throw new Error(
        `--langfuse would send participants' words to ${config.baseUrl}. ` +
          "Name its host in STUDY_JUDGE_LANGFUSE_HOSTS if that instance may see them.",
      );
    }
    langfuse = startLangfuse(config);
  }

  const blocks = await loadJudgeBlocks();
  const { items: all, key } = buildJudgeItems(blocks, {
    salt,
    repeats,
    blindCheck: has("blind-check"),
  });
  const items = all.slice(0, limit);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "key.csv"), toCsv(key));
  await writeFile(
    join(outDir, "items.jsonl"),
    items.map((i) => JSON.stringify({ id: i.id, kind: i.kind, messages: i.messages })).join("\n") + (items.length ? "\n" : ""),
  );
  console.log(`${blocks.length} blocks, ${items.length} items to judge with the ${role} model — key.csv is the only file that names a block`);

  const run = `study-judge-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const call = async (item: JudgeItem) => {
    const startedAt = new Date();
    const result = await chat(item.messages, {
      role,
      json: true,
      temperature: null,
      maxTokens: 900,
      metadata: { generation_name: "study-judge", tags: ["study-judge", item.kind] },
    });
    if (langfuse) {
      // The run and the item, never the block or its view.
      traceTurn(langfuse, {
        name: "study-judge",
        sessionId: run,
        tags: ["study-judge", item.kind],
        version: STUDY_JUDGE_VERSION,
        input: item.messages,
        output: result.content,
        metadata: { kind: item.kind, item: item.id },
        generations: [
          {
            name: "judge",
            model: result.resolvedModel,
            input: item.messages,
            output: result.content,
            startedAt,
            latencyMs: result.latencyMs,
            usage: { input: result.usage.promptTokens, output: result.usage.completionTokens },
          },
        ],
        scores: [],
        startedAt,
      });
    }
    return { content: result.content, model: result.resolvedModel, latencyMs: result.latencyMs };
  };
  const scores = await runJudge(items, call, (row, done) => {
    if (row.error) console.warn(`  ${done}/${items.length} ${row.kind} ${row.id}: ${row.error}`);
    else if (done % 10 === 0 || done === items.length) console.log(`  ${done}/${items.length}`);
  });
  await writeFile(join(outDir, "scores.csv"), toCsv(scores));
  if (langfuse) await flushLangfuse(langfuse);
  const failed = scores.filter((r) => r.error).length;
  console.log(`${join(outDir, "scores.csv")}  ${scores.length} scored${failed ? `, ${failed} failed` : ""}. Join with --join.`);
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
    case "prolific":
      return runProlific();
    case "week":
      return runWeek();
    case "session":
      return runSession();
    case "judge":
      return runStudyJudge();
    default:
      throw new Error(
        "usage: study-admin <export|metrics|review|participant|condition|prolific|week|session|judge> [--user <id>] …",
      );
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
