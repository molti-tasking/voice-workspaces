/**
 * The field study's researcher controls.
 *
 *   pnpm study:export [--user <id>] [--out <dir>]        one JSONL file per participant
 *   pnpm study:export --user <id> --include-text          pilot accounts only; see below
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

async function main(): Promise<void> {
  switch (process.argv[2]) {
    case "export":
      return runExport();
    case "participant":
      return runParticipant();
    case "condition":
      return runCondition();
    default:
      throw new Error("usage: study-admin <export|participant|condition> [--user <id>] …");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
