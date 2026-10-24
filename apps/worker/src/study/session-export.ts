import { asc, eq, getDb, inArray, sql } from "@voicemural/db";
import { captureSession, driveSubject, subjectSignal } from "@voicemural/db/schema";
import {
  listSessions,
  loadDriveLines,
  loadMoments,
  loadSubjectVisits,
  type DriveLine,
  type StudyMoment,
  type SubjectVisitRow,
} from "@voicemural/db/study-session";
import { SessionFinal } from "@voicemural/shared";
import type { Row } from "./prolific-export";

/**
 * The display study's data (`study_session`, `study_block`, `study_moment`),
 * as flat files keyed by the session's pseudonym (`ref`):
 *
 * - `sessions`: one row per session — its design, cell, view and task, when
 *   it was done, and the last questions.
 * - `blocks`: one row per conversation — its view and task, how long it ran
 *   and how much each side said outside the interruption, the game, how long
 *   they took to pick the conversation up, the one-tap prompts, and what they
 *   wrote and rated after it.
 * - `moments`: every moment as stored, with its latency.
 * - `transcripts` (only with `--text`): each block's lines, both sides, with
 *   the interruption and the spark-asked turns marked.
 *
 * TEXT IS INCLUDED — summaries, what they wrote about the game, reasons, and
 * with `--text` the transcripts: the session's consent says the researchers
 * read them.
 */

/**
 * The interruption on the drive's clock: from the game taking the screen to
 * the conversation coming back, which is the game's end. Anything said in it
 * was not said to the conversation — the agent was paused and not listening
 * — so it counts for neither side.
 */
export function pauseWindow(moments: readonly StudyMoment[]): { fromMs: number; toMs: number } | null {
  const game = moments.find((m) => m.kind === "game");
  if (!game) return null;
  const resume = moments.find((m) => m.kind === "resume");
  const toMs = resume?.shownOffsetMs ?? game.answeredOffsetMs ?? game.shownOffsetMs;
  return { fromMs: game.shownOffsetMs, toMs };
}

/** The subject the talk was on at `atMs`: the visit that holds it, an open one running on. */
export function subjectAt(visits: readonly SubjectVisitRow[], atMs: number): number | null {
  let found: number | null = null;
  for (const [i, v] of visits.entries()) {
    const end = v.endMs ?? visits[i + 1]?.startMs ?? Number.POSITIVE_INFINITY;
    if (v.startMs <= atMs && atMs < end) found = v.ordinal;
  }
  return found;
}

const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const seconds = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);

export interface BlockInput {
  startedAt: Date;
  /** When the drive ended, or null if it never closed. */
  endedAt: Date | null;
  lines: readonly DriveLine[];
  visits: readonly SubjectVisitRow[];
  moments: readonly StudyMoment[];
}

/**
 * What one block's conversation measured, from its drive alone.
 *
 * TWO RESUMPTION LATENCIES, because neither is the whole truth. The phone's
 * (`resume_first_speech_ms`) is the moment its voice detection heard them
 * after the conversation came back — on the same clock as the moment, so
 * exact, but it fires on any sound. The ledger's
 * (`resume_first_utterance_ms`) is the start of their first transcribed
 * words, which are words, but placed by the chunk pipeline about a second
 * either way.
 *
 * `same_subject` compares the subject the talk was on as the game came with
 * the one their first words after it were filed under. Subjects are named
 * after the fact, so a return to the old subject can be filed under it a
 * little late; the judge's reading of the transcript is the better measure,
 * this the cheap one.
 */
export function blockMeasures(input: BlockInput): Row {
  const { startedAt, endedAt, lines, visits, moments } = input;
  const pause = pauseWindow(moments);
  const inPause = (ms: number) => pause !== null && ms >= pause.fromMs && ms < pause.toMs;
  const said = lines.filter((l) => !inPause(l.startMs));
  const theirs = said.filter((l) => l.who === "user");
  const agents = said.filter((l) => l.who === "agent");
  const driveMs = endedAt ? endedAt.getTime() - startedAt.getTime() : null;
  const pauseMs = pause ? pause.toMs - pause.fromMs : 0;

  const game = moments.find((m) => m.kind === "game");
  const gameMeta = (game?.meta ?? {}) as Record<string, unknown>;
  const resume = moments.find((m) => m.kind === "resume");
  const firstWords = resume ? lines.find((l) => l.who === "user" && l.startMs >= resume.shownOffsetMs) : undefined;
  const before = game ? subjectAt(visits, game.shownOffsetMs - 1) : null;
  const after = firstWords ? subjectAt(visits, firstWords.startMs) : null;
  const esm = (ordinal: number) => moments.find((m) => m.kind === "esm" && m.ordinal === ordinal);
  const esmValue = (ordinal: number) => {
    const m = esm(ordinal);
    return m ? m.value : null;
  };
  const esmState = (ordinal: number) => {
    const m = esm(ordinal);
    if (!m) return ordinal === 0 && gameMeta.promptBeforeMissed === true ? "missed" : "not_shown";
    return m.value === null ? "expired" : "answered";
  };

  return {
    drive_seconds: seconds(driveMs),
    pause_seconds: seconds(pauseMs),
    talk_seconds: driveMs === null ? null : seconds(driveMs - pauseMs),
    user_turns: theirs.length,
    user_words: theirs.reduce((n, l) => n + wordCount(l.text), 0),
    agent_turns: agents.length,
    agent_words: agents.reduce((n, l) => n + wordCount(l.text), 0),
    spark_turns: agents.filter((l) => l.spark !== null).length,
    words_in_pause: lines.filter((l) => inPause(l.startMs)).reduce((n, l) => n + wordCount(l.text), 0),
    subjects: new Set(visits.map((v) => v.ordinal)).size,
    game_at_seconds: seconds(game?.shownOffsetMs ?? null),
    game_seconds:
      game && game.answeredOffsetMs !== null ? seconds(game.answeredOffsetMs - game.shownOffsetMs) : null,
    game_rounds: typeof gameMeta.rounds === "number" ? gameMeta.rounds : null,
    game_won: typeof gameMeta.won === "number" ? gameMeta.won : null,
    game_lost: typeof gameMeta.lost === "number" ? gameMeta.lost : null,
    game_drawn: typeof gameMeta.drawn === "number" ? gameMeta.drawn : null,
    game_moves: typeof gameMeta.moves === "number" ? gameMeta.moves : null,
    game_cut_off: typeof gameMeta.cutOff === "boolean" ? gameMeta.cutOff : null,
    resume_first_speech_ms:
      resume && resume.answeredOffsetMs !== null ? resume.answeredOffsetMs - resume.shownOffsetMs : null,
    resume_first_utterance_ms: resume && firstWords ? firstWords.startMs - resume.shownOffsetMs : null,
    subject_before_game: before,
    subject_after_game: after,
    same_subject: before !== null && after !== null ? before === after : null,
    esm_follow_before: esmValue(0),
    esm_follow_before_state: esmState(0),
    esm_follow_after: esmValue(1),
    esm_follow_after_state: esmState(1),
    esm_effort: esmValue(2),
    esm_effort_state: esmState(2),
  };
}

export interface TranscriptRecord {
  ref: string;
  position: number;
  display: string;
  task: string;
  capture_session_id: string;
  pause: { from_ms: number; to_ms: number } | null;
  lines: { who: "user" | "agent"; start_ms: number; end_ms: number; text: string; spark: string | null; in_pause: boolean }[];
}

export interface SessionExport {
  sessions: Row[];
  blocks: Row[];
  moments: Row[];
  transcripts: TranscriptRecord[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Every session, as the files above. `text` adds the transcripts. */
export async function buildSessionExport(options: { text?: boolean } = {}): Promise<SessionExport> {
  const db = getDb();
  const all = await listSessions();
  const blocks = all.flatMap(({ session, blocks }) => blocks.map((block) => ({ session, block })));
  const driveIds = blocks.map((b) => b.block.captureSessionId).filter((id): id is string => id !== null);

  const drives = driveIds.length
    ? await db
        .select({ id: captureSession.id, startedAt: captureSession.startedAt, endedAt: captureSession.endedAt })
        .from(captureSession)
        .where(inArray(captureSession.id, driveIds))
    : [];
  const sparks = driveIds.length
    ? await db
        .select({
          id: driveSubject.captureSessionId,
          shown: sql<number>`coalesce(sum(coalesce(array_length(${subjectSignal.sparksShown}, 1), 0)), 0)::int`,
          pulled: sql<number>`coalesce(sum(coalesce(array_length(${subjectSignal.sparksPulled}, 1), 0)), 0)::int`,
        })
        .from(driveSubject)
        .innerJoin(subjectSignal, eq(subjectSignal.driveSubjectId, driveSubject.id))
        .where(inArray(driveSubject.captureSessionId, driveIds))
        .groupBy(driveSubject.captureSessionId)
        .orderBy(asc(driveSubject.captureSessionId))
    : [];
  const moments = await loadMoments(driveIds);

  const sessions: Row[] = all.map(({ session, blocks: mine }) => {
    const { version, ...stored } = (session.final ?? {}) as Record<string, unknown>;
    const final = SessionFinal.safeParse(session.final ? stored : null);
    return {
      ref: session.ref,
      source: session.source,
      design: session.design,
      order_index: session.orderIndex,
      // The session's view and task; space-separated for session-1's four.
      display: mine.map((b) => b.display).join(" "),
      task: mine.map((b) => b.task).join(" "),
      created_at: iso(session.createdAt),
      consented_at: iso(session.consentedAt),
      completed_at: iso(session.completedAt),
      blocks_answered: mine.filter((b) => b.answeredAt).length,
      restarts: mine.reduce((n, b) => n + Math.max(0, b.attempts - 1), 0),
      more: final.success ? (final.data.more ?? null) : null,
      contact: final.success ? final.data.contact : null,
      version: typeof version === "string" ? version : null,
    };
  });

  const blockRows: Row[] = [];
  const momentRows: Row[] = [];
  const transcripts: TranscriptRecord[] = [];
  for (const { session, block } of blocks) {
    const answers = (block.answers ?? {}) as Record<string, unknown>;
    const head: Row = {
      ref: session.ref,
      position: block.position,
      display: block.display,
      task: block.task,
      attempts: block.attempts,
    };
    const tail: Row = {
      finished_at: iso(block.finishedAt),
      summary: block.summary,
      follow: (answers.follow as number | undefined) ?? null,
      effort: (answers.effort as number | undefined) ?? null,
      pickup: (answers.pickup as number | undefined) ?? null,
      // Their own account of the game, for reading; the judge never sees it.
      before_game: (answers.beforeGame as string | undefined) ?? null,
      way_back: (answers.wayBack as string | undefined) ?? null,
      glance: (answers.glance as number | undefined) ?? null,
      helped: (answers.helped as string | undefined) ?? null,
      answered_at: iso(block.answeredAt),
      version: (answers.version as string | undefined) ?? null,
    };
    const drive = drives.find((d) => d.id === block.captureSessionId);
    if (!block.captureSessionId || !drive) {
      blockRows.push({ ...head, capture_session_id: null, ...tail });
      continue;
    }
    const mine = moments.filter((m) => m.captureSessionId === block.captureSessionId);
    const [lines, visits] = await Promise.all([
      loadDriveLines(block.captureSessionId),
      loadSubjectVisits(block.captureSessionId),
    ]);
    const spark = sparks.find((s) => s.id === block.captureSessionId);
    blockRows.push({
      ...head,
      capture_session_id: block.captureSessionId,
      started_at: iso(drive.startedAt),
      ...blockMeasures({ startedAt: drive.startedAt, endedAt: drive.endedAt, lines, visits, moments: mine }),
      sparks_shown: spark?.shown ?? 0,
      sparks_pulled: spark?.pulled ?? 0,
      ...tail,
    });
    for (const m of mine) {
      momentRows.push({
        ...head,
        kind: m.kind,
        ordinal: m.ordinal,
        item: m.item,
        shown_offset_ms: m.shownOffsetMs,
        answered_offset_ms: m.answeredOffsetMs,
        latency_ms: m.answeredOffsetMs === null ? null : m.answeredOffsetMs - m.shownOffsetMs,
        value: m.value,
        text: m.text,
        meta: Object.keys(m.meta ?? {}).length ? JSON.stringify(m.meta) : null,
      });
    }
    if (options.text) {
      const pause = pauseWindow(mine);
      transcripts.push({
        ref: session.ref,
        position: block.position,
        display: block.display,
        task: block.task,
        capture_session_id: block.captureSessionId,
        pause: pause ? { from_ms: pause.fromMs, to_ms: pause.toMs } : null,
        lines: lines.map((l) => ({
          who: l.who,
          start_ms: l.startMs,
          end_ms: l.endMs,
          text: l.text,
          spark: l.spark,
          in_pause: pause !== null && l.startMs >= pause.fromMs && l.startMs < pause.toMs,
        })),
      });
    }
  }

  // One shape for every row of a file, whether or not its block was talked.
  return { sessions, blocks: sameColumns(blockRows), moments: momentRows, transcripts };
}

/** Every row with every column, in the order of the row that has the most (a talked block's). */
export function sameColumns(rows: Row[]): Row[] {
  const widest = rows.reduce<Row>((w, r) => (Object.keys(r).length > Object.keys(w).length ? r : w), {});
  const columns = [...new Set([...Object.keys(widest), ...rows.flatMap((r) => Object.keys(r))])];
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
}
