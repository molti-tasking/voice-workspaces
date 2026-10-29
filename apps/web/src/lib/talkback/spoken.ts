/**
 * A turn's words as the screen lays them out while its voice is speaking it.
 *
 * WORDS STAY WHERE THEY ARE. A line that grows word by word re-wraps on every
 * word, and a window of the newest words slides on every word: either way the
 * words move under the eye that is reading them. Instead the layout is made
 * of words that are already known — the realtime engine has a reply's text
 * well before its voice says it (`voiced` on the turn) — and a word the voice
 * has not reached takes its place invisibly, then fades in when it is said.
 *
 * Laid out a sentence at a time, so what is reserved ahead of the voice is at
 * most the rest of the sentence being said: never a blank paragraph.
 *
 * Pure: the views draw it (`SpokenText`, the Stack and Recent views).
 */

export interface SpokenWord {
  text: string;
  /** Where it starts in the turn's text: its key, so a word keeps its element while the turn grows. */
  start: number;
  /** The voice has reached it: shown, and faded in if it was not before. */
  said: boolean;
}

/** A word that ends a sentence. */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/** Every word of `text`, said up to `voiced` characters; all of them when `voiced` is absent. */
export function spokenWords(text: string, voiced?: number): SpokenWord[] {
  const words: SpokenWord[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const start = match.index ?? 0;
    words.push({ text: match[0], start, said: voiced === undefined || start < voiced });
  }
  return words;
}

/** The sentences, as runs of word indices `[from, to)`. */
function sentences(words: readonly SpokenWord[]): [number, number][] {
  const runs: [number, number][] = [];
  let from = 0;
  words.forEach((word, i) => {
    if (SENTENCE_END.test(word.text) || i === words.length - 1) {
      runs.push([from, i + 1]);
      from = i + 1;
    }
  });
  return runs;
}

/** The index of the sentence the voice is in: the one with the first word not yet said, else the last. */
function speaking(words: readonly SpokenWord[], runs: readonly [number, number][]): number {
  const next = words.findIndex((w) => !w.said);
  if (next === -1) return runs.length - 1;
  return runs.findIndex(([from, to]) => next >= from && next < to);
}

/**
 * The turn as a line that only grows by whole sentences: everything up to the
 * end of the sentence being said, its words not yet said reserved.
 */
export function spokenLine(text: string, voiced?: number): SpokenWord[] {
  const words = spokenWords(text, voiced);
  if (voiced === undefined || words.length === 0) return words;
  const runs = sentences(words);
  return words.slice(0, runs[speaking(words, runs)]![1]);
}

export interface SpokenPage {
  words: SpokenWord[];
  /** The page starts inside a sentence too long for one page, not at its start. */
  midSentence: boolean;
  /** The page is not the turn's first: earlier words were said before it. */
  cut: boolean;
}

/**
 * The part of the turn a fixed space shows: the sentence being said — or of
 * one longer than `max` words, the run of `max` it is in — as a page that is
 * replaced whole by the next, never slid along word by word. A page stays up
 * until the voice says the next one's first word, so a sentence just finished
 * can still be read in the pause after it. Once the voice is done, the last.
 */
export function spokenPage(text: string, voiced: number | undefined, max: number): SpokenPage {
  const words = spokenWords(text, voiced);
  if (words.length === 0) return { words, midSentence: false, cut: false };
  const pages: { from: number; to: number; midSentence: boolean }[] = [];
  for (const [from, to] of sentences(words)) {
    for (let at = from; at < to; at += max) pages.push({ from: at, to: Math.min(to, at + max), midSentence: at > from });
  }
  const lastSaid = words.findLastIndex((w) => w.said);
  const page = lastSaid === -1 ? pages[0]! : pages.find((p) => lastSaid >= p.from && lastSaid < p.to)!;
  return { words: words.slice(page.from, page.to), midSentence: page.midSentence, cut: page.from > 0 };
}
