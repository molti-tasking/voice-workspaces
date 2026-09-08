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
  words: number;
  failures: string[];
  pass: boolean;
}

const PREAMBLE = /^(sure|certainly|of course|absolutely|great question|good question|okay so|ok so|let me|well,)/i;
const SIGN_OFF = /(let me know|hope that helps|feel free|happy to help)/i;
const MARKDOWN = /(^|\n)\s*([-*•]\s|#{1,6}\s|\d+\.\s)|\*\*|`/;
const EMOJI = /\p{Extended_Pictographic}/u;
const STAGE_DIRECTION = /^\s*[[(*].*[\])*]\s*$|\*[a-z ]+\*/i;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function checkReply(kase: EvalCase, rawReply: string, maxReplyWords: number): CheckResult {
  const failures: string[] = [];
  const silent = isSilence(rawReply);
  // `extractDrafts` mirrors `bot.py`: the draft body never reaches TTS, so it is
  // not held to the word cap, and what remains is `cleanReply`-ed speech.
  const extracted = silent ? null : extractDrafts(rawReply);
  const spoken = extracted?.speech ?? "";
  const drafts = extracted?.drafts.map((d) => d.title) ?? [];
  const words = countWords(spoken);

  if (kase.expect.turn === "silent" && !silent) {
    failures.push(`spoke when it should have stayed silent: ${JSON.stringify(spoken)}`);
  }
  if (kase.expect.turn === "speak" && silent) {
    failures.push("stayed silent when it should have spoken");
  }

  if (!silent) {
    if (!spoken && drafts.length === 0) failures.push("empty reply that is not the sentinel");
    if (words > maxReplyWords) failures.push(`${words} words, cap is ${maxReplyWords}`);
    if (PREAMBLE.test(spoken)) failures.push(`preamble: ${JSON.stringify(spoken.split(/\s+/).slice(0, 3).join(" "))}`);
    if (SIGN_OFF.test(spoken)) failures.push("sign-off");
    if (MARKDOWN.test(spoken)) failures.push("markdown in speech");
    if (EMOJI.test(spoken)) failures.push("emoji in speech");
    if (STAGE_DIRECTION.test(spoken)) failures.push("stage direction");
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

  return { silent, spoken, drafts, words, failures, pass: failures.length === 0 };
}
