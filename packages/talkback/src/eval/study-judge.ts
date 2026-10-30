/**
 * The display study's blind judge (`pnpm study:judge`): its rubrics, how a
 * conversation is laid out for it, and tolerant readers of what it answers.
 *
 * BLIND BY CONSTRUCTION. The judge reads a conversation and what the person
 * wrote, labelled Person and Assistant, and nothing that says how the phone
 * showed it: no view, no session, no position, and the words that would name
 * a view scrubbed (`scrubViewWords`). Which block an item was is kept apart
 * from the scores and joined back only at the end. The one exception is the
 * blind check, which asks the judge to guess the view and so has to describe
 * the setup's views — a guess no better than chance is what blind means.
 *
 * Pure: the worker makes the calls (apps/worker/src/study/session-judge.ts).
 */

import type { ChatMessage } from "@voicemural/llm";
import type { ConversationDisplay } from "@voicemural/shared";

/**
 * Bump when a rubric changes enough that scores should not be pooled.
 * study-judge-3 (30 Oct 2026): reflection tasks get their own summary rubric
 * (`REFLECTION_SUMMARY_PROMPT`); the planning one is unchanged, word for word.
 */
export const STUDY_JUDGE_VERSION = "study-judge-3";

export interface JudgeLine {
  who: "Person" | "Assistant";
  text: string;
}

/*
 * Words that name or describe one of the views. A person who says "the
 * bubbles helped" has told the judge which block this was. Replaced, not
 * dropped, so the sentence still reads as having said something.
 */
const VIEW_WORDS =
  /\b(?:transcripts?|word[- ]for[- ]word|bubbles?|circles?|headlines?|mirror|sparks?|topic map|topics in order|(?:on|at) (?:the|my|your) (?:screen|phone))\b/gi;

export function scrubViewWords(text: string): string {
  return text.replace(VIEW_WORDS, "[…]");
}

/** Lines as the judge reads them, one per line; numbered from 1 when it must point at one. */
export function renderLines(lines: readonly JudgeLine[], options: { numbered?: boolean } = {}): string {
  if (lines.length === 0) return "(nothing was said)";
  return lines.map((l, i) => `${options.numbered ? `[${i + 1}] ` : ""}${l.who}: ${l.text}`).join("\n");
}

export const SUMMARY_PROMPT = `You are scoring how well a person summarised a conversation they had just had with a voice assistant about an everyday planning problem. You will see the conversation, transcribed by machine (expect errors), and the summary the person wrote straight afterwards, from memory, without seeing the conversation.

1. List the key points of the conversation: the decisions reached, the options still open, and the constraints that shaped them — usually three to eight. A point counts whoever raised it.
2. For each, say whether the summary has it: "present", "partial" (mentioned, but vague or incomplete) or "absent".
3. Count "invented": points in the summary that contradict the conversation or were never said in it.
4. Score from 1 (poor) to 5 (excellent):
   coverage — how much of what mattered is in the summary;
   accuracy — whether what the summary says matches the conversation;
   specificity — whether it names the actual choices (places, amounts, days) rather than generalities.

Do not reward length, polish or spelling: a short summary with the key points right scores high.

Reply with ONLY a JSON object of this shape, nothing else:
{"key_points": [{"point": "…", "in_summary": "present" | "partial" | "absent"}], "invented": 0, "coverage": 1-5, "accuracy": 1-5, "specificity": 1-5, "reason": "one sentence"}`;

/**
 * The summary rubric for a reflection task (`kind: "reflect"`). A reflection
 * reaches few decisions, so the planning rubric's "decisions reached, options
 * still open" would score a good summary of one as empty. Same scale and the
 * same JSON shape, so the two read into one table; compare them within a kind.
 */
export const REFLECTION_SUMMARY_PROMPT = `You are scoring how well a person summarised a conversation they had just had with a voice assistant, in which they looked back on a week. You will see the conversation, transcribed by machine (expect errors), and the summary the person wrote straight afterwards, from memory, without seeing the conversation.

1. List the key points of the conversation: what happened that they talked about, what they made of it (what went well, what did not, and why), and anything they said they would do differently — usually three to eight. A point counts whoever raised it.
2. For each, say whether the summary has it: "present", "partial" (mentioned, but vague or incomplete) or "absent".
3. Count "invented": points in the summary that contradict the conversation or were never said in it.
4. Score from 1 (poor) to 5 (excellent):
   coverage — how much of what mattered is in the summary;
   accuracy — whether what the summary says matches the conversation;
   specificity — whether it names the actual events, reasons and intentions rather than generalities.

Do not reward length, polish or spelling: a short summary with the key points right scores high. Do not judge the person or their week, only the summary.

Reply with ONLY a JSON object of this shape, nothing else:
{"key_points": [{"point": "…", "in_summary": "present" | "partial" | "absent"}], "invented": 0, "coverage": 1-5, "accuracy": 1-5, "specificity": 1-5, "reason": "one sentence"}`;

export const RESUMPTION_PROMPT = `You are scoring how a person picked a conversation with a voice assistant back up after an interruption. Partway through, they were taken away for about a minute to play a game. When it ended, the conversation came straight back, and they went on talking with nothing to remind them where they had been.

You will see BEFORE (the end of the conversation before the interruption) and AFTER (the conversation after it, with numbered lines). The conversation was transcribed by machine; expect errors.

resumed_same_topic — "yes" if the Person's first words after the interruption continue the topic that was open just before it, "no" if they start on something else, "unclear" if you cannot tell.
first_on_topic_line — the number of the first AFTER line in which the Person is back on that topic, or null if they never return to it.
asked_assistant — true if the Person asks the assistant where they were or what had been said.

Reply with ONLY a JSON object of this shape, nothing else:
{"resumed_same_topic": "yes" | "no" | "unclear", "first_on_topic_line": 3 | null, "asked_assistant": true | false, "reason": "one sentence"}`;

/**
 * How the blind check describes each view: what the phone showed, never what
 * it was for. `uptake`'s reads as the same topics when the topic line is one
 * of the options before it, as in session-2's setup.
 */
export const BLIND_DESCRIPTIONS: Record<ConversationDisplay, string> = {
  chat: "every line, word for word, like a chat.",
  topics: "only the topics, one under the other in the order they came up, with a few short points for each.",
  uptake: "only the topics, each with the assistant's ideas on it marked as taken up by the person or not yet.",
  now: "one line saying where the conversation is now, under the name of the current topic.",
  open: "the questions the conversation raised, the open ones first and the settled ones ticked.",
  recent: "the last turn in full, with the turns before it shrunk to a word or two.",
  stack: "the topics as a stack, the current one largest at the bottom, each with what was decided on it.",
};

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven"];

/** The blind check for a setup's views: its prompt, and which view each letter is. */
export interface BlindCheck {
  prompt: string;
  /** Letter → view, in the setup's order: A is its first view. */
  options: Record<string, ConversationDisplay>;
}

/**
 * The blind check's options for `views`, lettered in their order. For
 * session-2's three it is word for word the prompt its scores were made
 * with (`study-judge-2`).
 */
export function blindCheck(views: readonly ConversationDisplay[]): BlindCheck {
  if (views.length < 2) throw new Error("a blind check needs two views or more to tell apart");
  const letters = views.map((_, i) => String.fromCharCode(65 + i));
  const describe = (view: ConversationDisplay, i: number) =>
    view === "uptake" && views.slice(0, i).includes("topics")
      ? "the same topics, each with the assistant's ideas on it marked as taken up by the person or not yet."
      : BLIND_DESCRIPTIONS[view];
  const prompt = `A person had this conversation with a voice assistant while their phone showed it in one of ${COUNT_WORDS[views.length] ?? views.length} ways:
${views.map((v, i) => `${letters[i]} — ${describe(v, i)}`).join("\n")}

From the conversation alone, which do you think it was? If nothing in it tells you, guess.

Reply with ONLY a JSON object of this shape, nothing else:
{"guess": ${letters.map((l) => `"${l}"`).join(" | ")}, "confidence": 1-5}`;
  return { prompt, options: Object.fromEntries(views.map((v, i) => [letters[i]!, v])) };
}

/** `reflection` picks the reflection rubric; planning tasks leave it off. */
export function summaryMessages(input: {
  lines: readonly JudgeLine[];
  summary: string;
  reflection?: boolean;
}): ChatMessage[] {
  return [
    { role: "system", content: input.reflection ? REFLECTION_SUMMARY_PROMPT : SUMMARY_PROMPT },
    {
      role: "user",
      content: `=== THE CONVERSATION ===\n${renderLines(input.lines)}\n\n=== THEIR SUMMARY ===\n${input.summary}`,
    },
  ];
}

/**
 * The resumption from the conversation alone. What they wrote afterwards
 * about where they had been is not shown: written once they had picked the
 * conversation up, it is their account of the resumption, not a measure of it.
 */
export function resumptionMessages(input: { before: readonly JudgeLine[]; after: readonly JudgeLine[] }): ChatMessage[] {
  return [
    { role: "system", content: RESUMPTION_PROMPT },
    {
      role: "user",
      content: `=== BEFORE ===\n${renderLines(input.before)}\n\n=== AFTER ===\n${renderLines(input.after, { numbered: true })}`,
    },
  ];
}

export function blindMessages(input: { lines: readonly JudgeLine[]; check: BlindCheck }): ChatMessage[] {
  return [
    { role: "system", content: input.check.prompt },
    { role: "user", content: `=== THE CONVERSATION ===\n${renderLines(input.lines)}` },
  ];
}

/* ---------------------------------------------------------------------------
 * Reading the answers
 * ------------------------------------------------------------------------- */

/** The JSON object in a reply, fenced or prefixed or not. Throws when there is none. */
function jsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`judge returned no JSON: ${raw.slice(0, 120)}`);
  const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`judge returned no JSON object: ${raw.slice(0, 120)}`);
  }
  return parsed as Record<string, unknown>;
}

function scoreOf(parsed: Record<string, unknown>, key: string): number {
  const value = Number(parsed[key]);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`judge score ${key} out of range: ${String(parsed[key])}`);
  }
  return value;
}

const reasonOf = (parsed: Record<string, unknown>) => (typeof parsed.reason === "string" ? parsed.reason : "");

export const POINT_STATES = ["present", "partial", "absent"] as const;
export type PointState = (typeof POINT_STATES)[number];

export interface SummaryJudgement {
  keyPoints: { point: string; inSummary: PointState }[];
  present: number;
  partial: number;
  absent: number;
  /** Present counts one, partial a half, over all the key points; null with none. */
  coverageShare: number | null;
  invented: number;
  coverage: number;
  accuracy: number;
  specificity: number;
  reason: string;
}

/** A key point the judge could not classify is dropped, not guessed at. */
export function parseSummaryJudgement(raw: string): SummaryJudgement {
  const parsed = jsonObject(raw);
  const points = Array.isArray(parsed.key_points) ? parsed.key_points : [];
  const keyPoints = points.flatMap((p) => {
    const entry = p as { point?: unknown; in_summary?: unknown };
    const state = typeof entry.in_summary === "string" ? entry.in_summary.toLowerCase().trim() : "";
    if (typeof entry.point !== "string" || !(POINT_STATES as readonly string[]).includes(state)) return [];
    return [{ point: entry.point, inSummary: state as PointState }];
  });
  const count = (state: PointState) => keyPoints.filter((p) => p.inSummary === state).length;
  const invented = Number(parsed.invented ?? 0);
  if (!Number.isInteger(invented) || invented < 0) throw new Error(`judge invented out of range: ${String(parsed.invented)}`);
  return {
    keyPoints,
    present: count("present"),
    partial: count("partial"),
    absent: count("absent"),
    coverageShare:
      keyPoints.length > 0 ? Math.round(((count("present") + count("partial") / 2) / keyPoints.length) * 100) / 100 : null,
    invented,
    coverage: scoreOf(parsed, "coverage"),
    accuracy: scoreOf(parsed, "accuracy"),
    specificity: scoreOf(parsed, "specificity"),
    reason: reasonOf(parsed),
  };
}

export interface ResumptionJudgement {
  resumedSameTopic: "yes" | "no" | "unclear";
  /** Within the AFTER lines the judge was shown, from 1; null if never. */
  firstOnTopicLine: number | null;
  askedAssistant: boolean;
  reason: string;
}

export function parseResumptionJudgement(raw: string, afterLines: number): ResumptionJudgement {
  const parsed = jsonObject(raw);
  const same = String(parsed.resumed_same_topic ?? "").toLowerCase().trim();
  const line = parsed.first_on_topic_line;
  const at = line === null || line === undefined || line === "null" ? null : Number(line);
  return {
    resumedSameTopic: same === "yes" || same === "no" ? same : "unclear",
    // A line it was not shown is no answer.
    firstOnTopicLine: at !== null && Number.isInteger(at) && at >= 1 && at <= afterLines ? at : null,
    askedAssistant: parsed.asked_assistant === true || parsed.asked_assistant === "true",
    reason: reasonOf(parsed),
  };
}

export interface BlindGuess {
  /** One of the check's letters. */
  guess: string;
  confidence: number;
}

export function parseBlindGuess(raw: string, letters: readonly string[]): BlindGuess {
  const parsed = jsonObject(raw);
  const guess = String(parsed.guess ?? "").trim().toUpperCase();
  if (!letters.includes(guess)) throw new Error(`judge guess not an option: ${String(parsed.guess)}`);
  return { guess, confidence: scoreOf(parsed, "confidence") };
}
