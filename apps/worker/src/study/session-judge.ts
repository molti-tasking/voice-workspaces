import { createHmac } from "node:crypto";
import {
  designPlan,
  listDesigns,
  listSessions,
  loadDriveLines,
  loadMoments,
  type DriveLine,
  type StudyMoment,
} from "@voicemural/db/study-session";
import type { ChatMessage } from "@voicemural/llm";
import { LEGACY_DESIGN, type SessionDisplay } from "@voicemural/shared";
import { keptIndices } from "@voicemural/talkback";
import {
  STUDY_JUDGE_VERSION,
  blindCheck,
  blindMessages,
  parseBlindGuess,
  parseResumptionJudgement,
  parseSummaryJudgement,
  resumptionMessages,
  scrubViewWords,
  summaryMessages,
  type JudgeLine,
} from "@voicemural/talkback/eval/study-judge";
import type { Row } from "./prolific-export";
import { pauseWindow, sameColumns } from "./session-export";

/**
 * The display study's blind judge, run over the database
 * (`pnpm study:judge`; rubrics in @voicemural/talkback/eval/study-judge).
 *
 * WHAT KEEPS IT BLIND:
 * - Items are built from the database alone — the ledger's lines and the
 *   moments — never from the live traces, whose prompts and metadata name
 *   the drive's condition.
 * - Person and Assistant; the interruption dropped (nothing in it was said
 *   to the conversation); their own voice echoed back from the agent
 *   removed; words naming a view scrubbed.
 * - An item's id is a keyed hash (`STUDY_JUDGE_SALT`) of the block and the
 *   item, so it says nothing by itself, and the items are judged in a
 *   shuffled order. Which block an id was lives only in the key, which the
 *   scores are joined to at the very end (`joinScores`).
 *
 * The judge is called through LiteLLM like everything else; a proxy that
 * logs its calls somewhere sees what it always sees. `--langfuse` sends the
 * run to Langfuse itself, with no condition in it, and only to a host
 * someone has allowed by name (see study-admin.ts).
 */

export type ItemKind = "summary" | "resumption" | "blind";

/** One block, as the judge's items are made from it. */
export interface JudgeBlock {
  ref: string;
  position: number;
  /** Its setup's name, and the views the setup compares: what the blind check offers. */
  design: string;
  views: readonly SessionDisplay[];
  display: string;
  task: string;
  summary: string | null;
  lines: readonly DriveLine[];
  moments: readonly StudyMoment[];
}

export interface JudgeItem {
  id: string;
  kind: ItemKind;
  messages: ChatMessage[];
  /** How many AFTER lines a resumption item shows, to check the line it names. */
  afterLines?: number;
  /** A blind check's letters and the view each is. */
  options?: Record<string, SessionDisplay>;
}

/** Which block and item an id is. Only `joinScores` reads it with the scores. */
export interface KeyRow extends Row {
  id: string;
  ref: string;
  position: number;
  design: string;
  display: string;
  task: string;
  kind: ItemKind;
  repeat: number;
  /** A blind check's letters as JSON (`{"A":"chat",…}`), for reading the guess back; null for the others. */
  options: string | null;
}

/** How much either side of the interruption the resumption item shows. */
const BEFORE_LINES = 10;
const AFTER_LINES = 10;

export interface JudgeLines {
  /** The whole conversation, as the judge reads it. */
  all: JudgeLine[];
  /** The last lines before the interruption. */
  before: JudgeLine[];
  /** The first lines after it. */
  after: JudgeLine[];
}

/** A block's conversation, blinded as above. */
export function judgeLinesOf(block: Pick<JudgeBlock, "lines" | "moments">): JudgeLines {
  const pause = pauseWindow([...block.moments]);
  const said = block.lines.filter((l) => !(pause && l.startMs >= pause.fromMs && l.startMs < pause.toMs));
  // Their lines that are the agent's voice coming back through the
  // microphone, or a transcription repeated, are dropped; the agent's stay.
  const theirs = said.filter((l) => l.who === "user");
  const kept = new Set(
    keptIndices(
      theirs.map((l) => l.text),
      said.filter((l) => l.who === "agent").map((l) => l.text),
    ).map((i) => theirs[i]!),
  );
  const shown = said.filter((l) => l.who === "agent" || kept.has(l));
  const label = (l: DriveLine): JudgeLine => ({ who: l.who === "user" ? "Person" : "Assistant", text: scrubViewWords(l.text) });
  return {
    all: shown.map(label),
    before: pause ? shown.filter((l) => l.startMs < pause.fromMs).slice(-BEFORE_LINES).map(label) : [],
    after: pause ? shown.filter((l) => l.startMs >= pause.toMs).slice(0, AFTER_LINES).map(label) : [],
  };
}

/** The id an item goes by: a keyed hash of what it is, so it gives nothing away. */
export function itemId(salt: string, ref: string, position: number, kind: ItemKind, repeat: number): string {
  return createHmac("sha256", salt).update(`${ref}|${position}|${kind}|${repeat}`).digest("hex").slice(0, 16);
}

/** Fisher–Yates, with an injectable source for the tests. */
function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The items to judge, in a shuffled order, and the key to them. A summary
 * item for every block with a summary, a resumption item for every block
 * with a game and something said after it, and — with `blindCheck` — a guess at the view
 * for every block. Each `repeats` times, for the judge's reliability.
 */
export function buildJudgeItems(
  blocks: readonly JudgeBlock[],
  options: { salt: string; repeats?: number; blindCheck?: boolean; random?: () => number },
): { items: JudgeItem[]; key: KeyRow[] } {
  const repeats = Math.max(1, Math.trunc(options.repeats ?? 1));
  const items: JudgeItem[] = [];
  const key: KeyRow[] = [];
  for (const block of blocks) {
    const lines = judgeLinesOf(block);
    if (lines.all.length === 0) continue;
    const made: Omit<JudgeItem, "id">[] = [];
    if (block.summary) {
      made.push({ kind: "summary", messages: summaryMessages({ lines: lines.all, summary: scrubViewWords(block.summary) }) });
    }
    if (lines.after.length > 0) {
      made.push({
        kind: "resumption",
        messages: resumptionMessages({ before: lines.before, after: lines.after }),
        afterLines: lines.after.length,
      });
    }
    // A setup of one view has nothing to guess between.
    if (options.blindCheck && block.views.length > 1) {
      const check = blindCheck(block.views);
      made.push({ kind: "blind", messages: blindMessages({ lines: lines.all, check }), options: check.options });
    }
    for (const item of made) {
      for (let repeat = 0; repeat < repeats; repeat++) {
        const id = itemId(options.salt, block.ref, block.position, item.kind, repeat);
        items.push({ id, ...item });
        key.push({
          id,
          ref: block.ref,
          position: block.position,
          design: block.design,
          display: block.display,
          task: block.task,
          kind: item.kind,
          repeat,
          options: item.options ? JSON.stringify(item.options) : null,
        });
      }
    }
  }
  return { items: shuffled(items, options.random ?? Math.random), key };
}

/** What a judge call answered. */
export interface JudgeAnswer {
  content: string;
  model: string;
  latencyMs: number;
}

/** One item's scores, by its id and nothing else. */
export function scoreRow(item: JudgeItem, answer: JudgeAnswer): Row {
  const head: Row = { id: item.id, kind: item.kind, model: answer.model, version: STUDY_JUDGE_VERSION };
  try {
    if (item.kind === "summary") {
      const j = parseSummaryJudgement(answer.content);
      return {
        ...head,
        coverage: j.coverage,
        accuracy: j.accuracy,
        specificity: j.specificity,
        key_points: j.keyPoints.length,
        present: j.present,
        partial: j.partial,
        absent: j.absent,
        coverage_share: j.coverageShare,
        invented: j.invented,
        points: JSON.stringify(j.keyPoints),
        reason: j.reason,
        error: null,
      };
    }
    if (item.kind === "resumption") {
      const j = parseResumptionJudgement(answer.content, item.afterLines ?? 0);
      return {
        ...head,
        resumed_same_topic: j.resumedSameTopic,
        first_on_topic_line: j.firstOnTopicLine,
        asked_assistant: j.askedAssistant,
        reason: j.reason,
        error: null,
      };
    }
    const j = parseBlindGuess(answer.content, Object.keys(item.options ?? {}));
    return { ...head, guess: j.guess, confidence: j.confidence, error: null };
  } catch (err) {
    return { ...head, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Judge every item, one at a time — the judge's GPU is shared — and score
 * each answer. A call or a reading that fails is kept as an error row
 * rather than ending the run.
 */
export async function runJudge(
  items: readonly JudgeItem[],
  call: (item: JudgeItem) => Promise<JudgeAnswer>,
  onScored?: (row: Row, done: number) => void,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const item of items) {
    let row: Row;
    try {
      row = scoreRow(item, await call(item));
    } catch (err) {
      row = { id: item.id, kind: item.kind, model: null, version: STUDY_JUDGE_VERSION, error: err instanceof Error ? err.message : String(err) };
    }
    rows.push(row);
    onScored?.(row, rows.length);
  }
  return sameColumns(rows);
}

/**
 * The scores with the key: the one step that puts an item's view next to
 * its scores. A blind-check guess is read back as a view, and whether it
 * was right.
 */
export function joinScores(scores: readonly Row[], key: readonly Row[]): Row[] {
  const byId = new Map(key.map((k) => [String(k.id), k]));
  return sameColumns(
    scores.map((s) => {
      const k = byId.get(String(s.id));
      const joined: Row = { ...k, ...s };
      const letters = blindLetters(k?.options);
      if (s.kind === "blind" && typeof s.guess === "string" && Object.hasOwn(letters, s.guess)) {
        const view = letters[s.guess]!;
        joined.guessed_view = view;
        joined.guessed_right = k ? view === k.display : null;
      }
      return joined;
    }),
  );
}

/** A key row's blind-check letters, back from the JSON the key holds them in. */
export function blindLetters(options: Row[string] | undefined): Record<string, string> {
  if (typeof options !== "string" || !options) return {};
  try {
    const parsed = JSON.parse(options) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Every answered block with a drive, as the judge's items are made from —
 * every setup's but session-1's, whose blocks were judged by another rubric,
 * with a note this one never sees. Tests never.
 */
export async function loadJudgeBlocks(): Promise<JudgeBlock[]> {
  const [all, designs] = await Promise.all([listSessions(), listDesigns()]);
  const views = new Map(designs.map(({ design }) => [design.name, designPlan(design).views]));
  const blocks = all
    .filter(({ session }) => session.design !== LEGACY_DESIGN)
    .flatMap(({ session, blocks }) =>
      blocks
        .filter((b) => b.captureSessionId && b.answeredAt)
        .map((b) => ({ ref: session.ref, design: session.design, block: b })),
    );
  const moments = await loadMoments(blocks.map((b) => b.block.captureSessionId!));
  const out: JudgeBlock[] = [];
  for (const { ref, design, block } of blocks) {
    out.push({
      ref,
      position: block.position,
      design,
      views: views.get(design) ?? [],
      display: block.display,
      task: block.task,
      summary: block.summary,
      lines: await loadDriveLines(block.captureSessionId!),
      moments: moments.filter((m) => m.captureSessionId === block.captureSessionId),
    });
  }
  return out;
}

/**
 * Whether `--langfuse` may send the run to this instance: its host must be
 * named in `STUDY_JUDGE_LANGFUSE_HOSTS`. The items carry participants' words,
 * so which instance may see them is decided on purpose, not by whatever
 * LANGFUSE_BASE_URL happens to say.
 */
export function langfuseAllowed(config: { baseUrl: string }, env: Record<string, string | undefined> = process.env): boolean {
  const hosts = (env.STUDY_JUDGE_LANGFUSE_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.includes(new URL(config.baseUrl).host.toLowerCase());
}

