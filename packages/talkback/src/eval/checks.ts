/**
 * What can be checked without a model.
 *
 * The output contract is mechanical — sentinel or speech, under the cap, no
 * markdown, no preamble, at most one question — and a mechanical check is
 * faster, free and never wrong about it. Everything that needs judgement is
 * left to `judge.ts`; a failure here is a defect, a low score there is a
 * question.
 *
 * Pure, and tested.
 */

import { extractDrafts, isSilence } from "../prompt";
import type { EvalCase } from "./cases";

export interface CheckResult {
  silent: boolean;
  /** The reply as it would have been spoken. Empty when silent. */
  spoken: string;
  /** Titles of any `<draft>` blocks — text kept, never spoken, and not checked as speech. */
  drafts: string[];
  /** `revises` handles, aligned with `drafts`; undefined where the draft is new. */
  revises: (string | undefined)[];
  words: number;
  failures: string[];
  pass: boolean;
}

const PREAMBLE = /^(sure|certainly|of course|absolutely|great question|good question|okay so|ok so|let me|well,)/i;
const SIGN_OFF = /(let me know|hope that helps|feel free|happy to help)/i;
const MARKDOWN = /(^|\n)\s*([-*•]\s|#{1,6}\s|\d+\.\s)|\*\*|`/;
const EMOJI = /\p{Extended_Pictographic}/u;
const STAGE_DIRECTION = /^\s*[[(*].*[\])*]\s*$|\*[a-z ]+\*/i;
// Once two voices are heard the model reads `[Speaker N]` on every line and
// copies it into replies; spoken, that is "bracket speaker two".
const SPEAKER_TAG = /\[speaker \d+\]/i;
// A reply that narrates the turn decision instead of making it. Observed on a
// two-person drive, 9 Sep 2026: "[Speaker 2]'s question — whether it'll talk
// back — is for them to test live, not for me to answer." Thinking is off in
// the container, so deliberation that leaks goes straight to TTS.
const NARRATED_DECISION =
  /\b(not for me to|for them to (test|answer|decide)|i('ll| will| should| am going to) (stay|remain|keep) (silent|quiet)|no (reply|response) (is )?(needed|required)|(does not|doesn't) (need|require) a (reply|response))\b/i;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Whether this case's history really does end with the agent asking something.
 *
 * Used to validate `expect.answering` rather than to infer it. The two facts
 * are not the same: `pending-asked-once` also ends on an agent question, and
 * the right reply there is silence, because what the driver said next was the
 * middle of a different sentence and not an answer at all. So the case says
 * whether it is an answer, and this checks the case is not lying about the
 * setup — a case claiming `answering` with no question behind it would pass
 * vacuously and pin nothing.
 */
export function endsOnAnAgentQuestion(kase: EvalCase): boolean {
  const last = kase.history?.at(-1);
  if (!kase.said?.trim() || last?.role !== "assistant") return false;
  return /\?["'`*)\]\s]*$/.test(last.content.trim());
}

export interface MadeToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export function checkReply(
  kase: EvalCase,
  rawReply: string,
  maxReplyWords: number,
  toolCalls: readonly MadeToolCall[] = [],
): CheckResult {
  const failures: string[] = [];

  // A step that called a tool is judged on the call. Its words, if any, are
  // still held to the output contract below; its silence is not a decline.
  const expected = kase.expect.toolCall;
  if (expected) {
    const call = toolCalls.find((c) => c.name === expected.name);
    if (!call) {
      failures.push(
        toolCalls.length
          ? `called ${toolCalls.map((c) => c.name).join(", ")}, expected ${expected.name}`
          : `did not call ${expected.name}`,
      );
    } else {
      for (const [key, source] of Object.entries(expected.args ?? {})) {
        const value = call.arguments[key];
        if (typeof value !== "string" || !new RegExp(source, "i").test(value)) {
          failures.push(`${expected.name}.${key} = ${JSON.stringify(value)}, expected /${source}/`);
        }
      }
    }
    if (!rawReply.trim()) {
      return { silent: false, spoken: "", drafts: [], revises: [], words: 0, failures, pass: failures.length === 0 };
    }
  } else if (toolCalls.length) {
    failures.push(`unexpected tool call: ${toolCalls.map((c) => `${c.name}(${JSON.stringify(c.arguments)})`).join(", ")}`);
    if (!rawReply.trim()) {
      return { silent: false, spoken: "", drafts: [], revises: [], words: 0, failures, pass: false };
    }
  }

  const silent = isSilence(rawReply);
  // `extractDrafts` mirrors `bot.py`: the draft body never reaches TTS, so it is
  // not held to the word cap, and what remains is `cleanReply`-ed speech.
  const extracted = silent ? null : extractDrafts(rawReply);
  const spoken = extracted?.speech ?? "";
  const drafts = extracted?.drafts.map((d) => d.title) ?? [];
  const revises = extracted?.drafts.map((d) => d.revises) ?? [];
  const words = countWords(spoken);

  /* What the reply did with the draft tag, when that is what the case is about.
   *
   * Checked here rather than left to the judge because it is mechanical: either
   * the tag carries a handle that resolves to the draft they asked about, or it
   * does not. The judge's question is whether the new text is any good; this
   * one's is whether the person ends up with one draft or two, and getting that
   * wrong is the whole failure talkback-12 exists to close. */
  if (kase.expect.draft !== undefined) {
    const wanted = kase.expect.draft;
    if (wanted === null) {
      if (drafts.length > 0) {
        failures.push(`wrote ${drafts.length} draft(s) where none was wanted`);
      }
    } else if (extracted === null || extracted.drafts.length !== 1) {
      failures.push(`expected exactly one draft, got ${extracted?.drafts.length ?? 0}`);
    } else {
      const got = extracted.drafts[0]!.revises;
      if (wanted.revises === null && got !== undefined) {
        failures.push(`revised ${got} where a NEW draft was wanted`);
      }
      if (wanted.revises !== null && (got === undefined || !wanted.revises.test(got))) {
        // A rewrite aimed at nothing is the old behaviour: a second card with
        // no link to the one it replaced.
        failures.push(`expected revises matching ${wanted.revises}, got ${got ?? "a new draft"}`);
      }
    }
  }

  if (kase.expect.turn === "silent" && !silent && !expected) {
    failures.push(`spoke when it should have stayed silent: ${JSON.stringify(spoken)}`);
  }
  if (kase.expect.turn === "speak" && silent && !expected) {
    failures.push("stayed silent when it should have spoken");
  }
  // Separate from the line above and not folded into it, because it is a
  // different claim. `turn` is what this case expects; `answering` is a rule
  // that holds whatever it expects, and it is the one talkback-13 exists for:
  // the pilot's agent asked a question, was told "Ja.", and said nothing. A
  // tool call counts as acting on the answer, which is why `expected` excuses
  // it here as it does above.
  if (kase.expect.answering && silent && !expected) {
    failures.push("declined an answer to its own question");
  }

  if (!silent) {
    if (!spoken && drafts.length === 0) failures.push("empty reply that is not the sentinel");
    if (words > maxReplyWords) failures.push(`${words} words, cap is ${maxReplyWords}`);
    if (PREAMBLE.test(spoken)) failures.push(`preamble: ${JSON.stringify(spoken.split(/\s+/).slice(0, 3).join(" "))}`);
    if (SIGN_OFF.test(spoken)) failures.push("sign-off");
    if (MARKDOWN.test(spoken)) failures.push("markdown in speech");
    if (EMOJI.test(spoken)) failures.push("emoji in speech");
    if (STAGE_DIRECTION.test(spoken)) failures.push("stage direction");
    if (SPEAKER_TAG.test(spoken)) failures.push("speaker tag spoken");
    if (NARRATED_DECISION.test(spoken)) failures.push("narrated decision");
    const questions = (spoken.match(/\?/g) ?? []).length;
    if (questions > 1) failures.push(`${questions} questions, at most one`);
    if (rawReply.includes("<silence>") && spoken) failures.push("sentinel emitted alongside speech");

    for (const source of kase.expect.mustMention ?? []) {
      if (!new RegExp(source, "i").test(spoken)) failures.push(`missing: /${source}/`);
    }
    for (const source of kase.expect.mustNotMention ?? []) {
      if (new RegExp(source, "i").test(spoken)) failures.push(`must not say: /${source}/`);
    }
  }

  return { silent, spoken, drafts, revises, words, failures, pass: failures.length === 0 };
}
