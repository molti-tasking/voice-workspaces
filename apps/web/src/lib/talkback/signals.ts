/**
 * Signals and sparks: what the person actually holds of each subject, and the
 * question to pull when they want to check.
 *
 * WHAT IT IS FOR. Floor control lets them decide WHEN the agent speaks. This
 * lets them see WHAT they hold. For every subject of the drive (a section of
 * `conversation.ts`) it works out whose words the subject is built on, whether
 * they settled it, how sure they sounded, and whether it is fading, and from
 * those suggests at most a few SPARKS: a short question about one subject
 * ("In your own words: where did you land?") that they can pull, through the
 * poke they already use, for the agent to ask.
 *
 * AN OFFER, NEVER A VERDICT. A spark is shown and pulled; the agent never
 * volunteers one (the container and the eval hold it to that). Every signal
 * comes with a reason in plain words, and nothing on screen is a number: the
 * person is told "mostly Souffleur's words", not "agent share 0.71".
 * Hesitation is measured against their own median for this drive, never
 * against anybody else.
 *
 * WORDS, NOT IDEAS. `agentShare` counts words. The agent rephrasing their idea
 * at length makes it look like the agent's, which is why the reasons say
 * "words" and why the recall probe asks whose idea it was — to check the proxy.
 *
 * Pure functions over a `Conversation`, so the thresholds are tested in vitest
 * and frozen with `SIGNALS_VERSION` before the study.
 */

import {
  countFillers,
  countHedges,
  countSelfRepairs,
  keepRequest,
  type SparkSelection,
} from "@voicemural/shared";
// The prompt's own list (talkback-21), so a kind the container cannot ask is a
// type error here. Type-only: nothing of the package reaches the browser.
import type { SparkKind } from "@voicemural/talkback";
import type { Conversation, KeepVia, Section, Turn } from "./conversation";

export type { SparkKind };

/**
 * Bump on any change to a threshold or a rule below. Stored with every
 * `subject_signal`, so the study can tell which rules a drive saw.
 */
export const SIGNALS_VERSION = "signals-2";

/** Below this many words in a subject, whose words they were is not shown. */
export const MIN_WORDS_FOR_SHARE = 40;
/** At or above this share of the agent's words, the subject wants saying back. */
export const SAY_BACK_SHARE = 0.6;
/** Their words after the agent's last turn that count as having said it back. */
export const RESTATED_WORDS = 20;
/** Their words in an unsettled subject before it is worth deciding. */
export const DECIDE_USER_WORDS = 60;
/** Their words in a subject before its hesitation is judged at all. */
export const MIN_WORDS_FOR_HESITATION = 30;
/** High: this many times their own median for the drive, and at least the floor. */
export const HESITATION_HIGH_RATIO = 1.5;
export const HESITATION_HIGH_FLOOR = 3;
/** Low: under this fraction of their median. */
export const HESITATION_LOW_RATIO = 0.67;
/** Subjects with a hesitation rate needed before any of them is called high or low. */
export const MIN_RATED_SUBJECTS = 2;
/** At most this many sparks are shown at once. */
export const MAX_SPARKS = 3;
/** A subject is fully faded after this many other subjects, or this many minutes. */
const FADE_SUBJECTS = 3;
const FADE_MINUTES = 10;

export type Level = "low" | "mid" | "high";

export interface SubjectSignal {
  key: string;
  ordinal: number | null;
  title: string | null;
  userWords: number;
  agentWords: number;
  /** The agent's share of the words; null below `MIN_WORDS_FOR_SHARE`. */
  agentShare: number | null;
  /** Said back in their own words since the agent last spoke on it. */
  restated: boolean;
  pauses: number;
  /** Of `pauses`, the ones before a turn began. Kept apart for the study; counted the same. */
  pausesBefore: number;
  fillers: number;
  selfRepairs: number;
  hedges: number;
  /** Cues per 100 of their words; null below `MIN_WORDS_FOR_HESITATION`. */
  hesitationRate: number | null;
  /** Against their own median for the drive; null until there is one. */
  hesitation: Level | null;
  /** Whether they stated a decision or a next step. Null: not judged yet. */
  settled: boolean | null;
  /** 0-1, from a fixed formula. Ranks sparks; never shown. */
  fade: number;
  /** They kept it, and how; null: Souffleur holds it. */
  keptVia: KeepVia | null;
  /** When they kept it, as epoch ms; null when not kept. */
  keptAt: number | null;
  /** One short line per signal, in plain words. Never a number. */
  reasons: string[];
}

export interface Spark {
  kind: SparkKind;
  key: string;
  ordinal: number;
  title: string;
  /** Why this one, in plain words: the reason behind the rule that fired. */
  reason: string;
}

/** Facts about the drive a subject's signals are judged against. */
export interface DriveContext {
  conversation: Conversation;
  /** Epoch ms, for how long ago a subject was last touched. */
  now: number;
  /** Their median hesitation rate this drive, over the subjects that have one. */
  medianHesitation: number | null;
  /** How many subjects have a hesitation rate at all. */
  ratedSubjects: number;
}

function words(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Their words in a turn, without fillers: an "um" is not a word they said about the subject. */
function userWordsIn(turn: Turn): number {
  return Math.max(0, words(turn.text) - countFillers(turn.text));
}

/** "Keep this one" is about keeping the subject, not part of it: never counted. */
function isKeepCommand(turn: Turn): boolean {
  return turn.who === "user" && keepRequest(turn.text) !== null;
}

function hesitationRateOf(section: Section): number | null {
  let userWords = 0;
  let cues = 0;
  for (const turn of section.turns) {
    if (turn.who !== "user" || isKeepCommand(turn)) continue;
    userWords += userWordsIn(turn);
    cues += (turn.pauses ?? 0) + countFillers(turn.text) + countSelfRepairs(turn.text) + countHedges(turn.text);
  }
  return userWords >= MIN_WORDS_FOR_HESITATION ? (cues / userWords) * 100 : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The drive-wide facts every subject's signals need, computed once. */
export function driveContext(conversation: Conversation, now: number): DriveContext {
  const rates = conversation.sections
    .map(hesitationRateOf)
    .filter((r): r is number => r !== null);
  return { conversation, now, medianHesitation: median(rates), ratedSubjects: rates.length };
}

function levelOf(rate: number | null, drive: DriveContext): Level | null {
  if (rate === null || drive.medianHesitation === null) return null;
  if (drive.ratedSubjects < MIN_RATED_SUBJECTS) return null;
  const m = drive.medianHesitation;
  if (rate >= HESITATION_HIGH_FLOOR && rate >= m * HESITATION_HIGH_RATIO) return "high";
  if (rate < m * HESITATION_LOW_RATIO) return "low";
  return "mid";
}

/**
 * How faded a subject is, 0-1: whose words it is built on, whether it was
 * settled, whether it was ever come back to, and how long ago it was left.
 * The current subject has not been left, so its recency term is zero.
 */
function fadeOf(
  section: Section,
  agentShare: number | null,
  settled: boolean | null,
  drive: DriveContext,
): number {
  const share = (agentShare ?? 0.5) * 0.3;
  const open = settled === false ? 0.25 : settled === null ? 0.1 : 0;
  const once = (section.visits ?? 1) <= 1 ? 0.15 : 0;
  let recency = 0;
  if (section.key !== drive.conversation.current) {
    const last = section.lastAt ?? 0;
    const since = drive.conversation.sections.filter(
      (s) => s.key !== section.key && (s.lastAt ?? 0) > last,
    ).length;
    const minutes = section.lastAt === undefined ? 0 : (drive.now - section.lastAt) / 60_000;
    recency = Math.min(1, Math.max(since / FADE_SUBJECTS, minutes / FADE_MINUTES)) * 0.3;
  }
  return Math.min(1, share + open + once + recency);
}

/** Every signal for one subject, with the reasons to show for them. */
export function signalsFor(section: Section, drive: DriveContext): SubjectSignal {
  let userWords = 0;
  let agentWords = 0;
  let fillers = 0;
  let selfRepairs = 0;
  let hedges = 0;
  let pauses = 0;
  let pausesBefore = 0;
  let sinceAgent = 0;
  for (const turn of section.turns) {
    if (isKeepCommand(turn)) continue;
    if (turn.who === "agent") {
      agentWords += words(turn.text);
      sinceAgent = 0;
      continue;
    }
    const said = userWordsIn(turn);
    userWords += said;
    sinceAgent += said;
    pauses += turn.pauses ?? 0;
    pausesBefore += turn.pausesBefore ?? 0;
    fillers += countFillers(turn.text);
    selfRepairs += countSelfRepairs(turn.text);
    hedges += countHedges(turn.text);
  }
  const total = userWords + agentWords;
  const agentShare = total >= MIN_WORDS_FOR_SHARE ? agentWords / total : null;
  const hesitationRate = hesitationRateOf(section);
  const hesitation = levelOf(hesitationRate, drive);
  const settled = section.settled ?? null;
  const fade = fadeOf(section, agentShare, settled, drive);

  const reasons: string[] = [];
  if (agentShare !== null) {
    reasons.push(
      agentShare >= SAY_BACK_SHARE
        ? "Mostly Souffleur's words"
        : agentShare <= 1 - SAY_BACK_SHARE
          ? "Mostly your words"
          : "Your words and Souffleur's",
    );
  }
  if (settled === true) reasons.push("You landed on something");
  else if (settled === false) reasons.push("Still open");
  if (hesitation === "high") reasons.push("You paused over this more than usual");
  else if (hesitation === "low") reasons.push("You sounded sure here");
  if (section.kept) reasons.push("You're keeping this one");

  return {
    key: section.key,
    ordinal: section.ordinal ?? null,
    title: section.title,
    userWords,
    agentWords,
    agentShare,
    restated: agentWords > 0 && sinceAgent >= RESTATED_WORDS,
    pauses,
    pausesBefore,
    fillers,
    selfRepairs,
    hedges,
    hesitationRate,
    hesitation,
    settled,
    fade,
    keptVia: section.kept?.via ?? null,
    keptAt: section.kept?.at ?? null,
    reasons,
  };
}

/** Every named subject's signals, in the order they came up. */
export function allSignals(conversation: Conversation, now: number): SubjectSignal[] {
  const drive = driveContext(conversation, now);
  return conversation.sections
    .filter((s) => s.title !== null && s.ordinal !== undefined)
    .map((s) => signalsFor(s, drive));
}

/**
 * The sparks to offer now: at most `MAX_SPARKS`, the most faded first, one per
 * subject, none for a subject that has had one pulled this drive.
 *
 * `pulled` holds the ordinals of those subjects. The rules are tried in order and
 * the first that matches is the subject's spark:
 *
 * - say_back: mostly the agent's words, and not said back since;
 * - decide: judged open, and they have said enough about it to decide;
 * - unsure: they hesitated over it more than usual for them;
 * - revisit: left, among the three most faded, and never come back to.
 *
 * WHO PICKS THE SUBJECTS is `selection` (`StudyCondition.sparkSelection`):
 *
 * - `suggested`: the rules above pick them, over every subject;
 * - `chosen`: the person did, by keeping them. Only kept subjects get a spark,
 *   and every kept subject gets one: the first rule that fits, or else
 *   `say_back` — keeping it was the request to practise it. A drive where they
 *   kept nothing offers nothing, which is the point.
 */
export function sparksFor(
  conversation: Conversation,
  now: number,
  pulled: ReadonlySet<number> = new Set(),
  selection: SparkSelection = "suggested",
): Spark[] {
  const signals = allSignals(conversation, now);
  const topFaded = new Set(
    [...signals]
      .sort((a, b) => b.fade - a.fade)
      .slice(0, 3)
      .map((s) => s.key),
  );
  const visits = new Map(conversation.sections.map((s) => [s.key, s.visits ?? 1]));

  const sparks: (Spark & { fade: number })[] = [];
  for (const signal of signals) {
    if (signal.ordinal === null || signal.title === null || pulled.has(signal.ordinal)) continue;
    if (selection === "chosen" && signal.keptVia === null) continue;
    const spark = (kind: SparkKind, reason: string) =>
      sparks.push({
        kind,
        key: signal.key,
        ordinal: signal.ordinal!,
        title: signal.title!,
        reason,
        fade: signal.fade,
      });
    if (
      signal.agentShare !== null &&
      signal.agentShare >= SAY_BACK_SHARE &&
      !signal.restated
    ) {
      spark("say_back", "Mostly Souffleur's words so far");
    } else if (signal.settled === false && signal.userWords >= DECIDE_USER_WORDS) {
      spark("decide", "You talked it through, and it is still open");
    } else if (signal.hesitation === "high") {
      spark("unsure", "You paused over this more than usual");
    } else if (
      signal.key !== conversation.current &&
      topFaded.has(signal.key) &&
      (visits.get(signal.key) ?? 1) <= 1
    ) {
      spark("revisit", "Left a while ago, and not come back to");
    } else if (selection === "chosen") {
      spark("say_back", "You're keeping this one");
    }
  }
  return sparks
    .sort((a, b) => b.fade - a.fade)
    .slice(0, MAX_SPARKS)
    .map(({ fade: _fade, ...spark }) => spark);
}
