// The `/digest` subpath, not the package index: the index pulls in server code.
import { GIST_WORDS, type DigestGist } from "@voicemural/talkback/digest";
import type { Conversation, Speaker } from "@/lib/talkback/conversation";
import { turnsInOrder } from "@/lib/talkback/cursor";
import { spokenPage, type SpokenWord } from "@/lib/talkback/spoken";

/**
 * What the Recent view draws, as data: the conversation shrunk by age.
 *
 * - `last`: the newest turn, in its own words — the tail of it, at most
 *   `LAST_WORDS`, so a long turn never fills the screen;
 * - `previous`: the turn before it, in two words;
 * - `earlier`: the `EARLIER_TURNS` turns before that, one word each;
 * - and above all of it the topic being talked about, the furthest zoom out.
 *
 * WHERE THE WORDS COME FROM. The digest's gists (`digest.ts`), written by the
 * model for the newest turns and matched by `seq`. A turn the digest has not
 * reached yet — the one just finished, a conversation with no AI behind it —
 * is shrunk here (`localGist`), so the rows never wait for a model call; the
 * model's words replace these once they arrive.
 *
 * A GUESS, THEN THE WORD, THEN NOTHING. A turn's own guess is `provisional`
 * and drawn lighter; the model's words replace it once, and are never
 * rewritten after that (`settleGists`) — a later digest that words the same
 * turn differently does not reach the screen. Progressive visualisation's
 * trade between following the data and keeping still (Angelini & Santucci
 * 2017), settled for keeping still.
 *
 * ROWS, NOT MOTION. A turn moves one row up only when a new turn begins, never
 * while it is being said, and the rows keep their places on the screen.
 *
 * Pure, so the view and its test read the same thing.
 */

/** The most of the newest turn shown: its last words. */
export const LAST_WORDS = 16;
/** Turns shown one word each, above the turn before last. */
export const EARLIER_TURNS = 3;

export interface RecentWords {
  seq: number;
  who: Speaker;
  text: string;
  /** Shrunk here, not yet by the model: drawn lighter until its words come. */
  provisional?: boolean;
}

export interface RecentLadder {
  earlier: RecentWords[];
  previous: RecentWords | null;
  /**
   * The newest turn: the sentence being said — or of a long one, its run of
   * `LAST_WORDS` — as a page the next replaces whole (lib/talkback/spoken.ts).
   * `cut`: earlier words of the turn are not on it. `spoken`: it is still
   * being said — the agent's voice, or their live words — so its words fade
   * in as they come.
   */
  last: (RecentWords & { cut: boolean; words: SpokenWord[]; spoken: boolean }) | null;
}

/**
 * The gists the screen has settled on: `settled` plus any turn it had none
 * for. A turn already settled keeps its words. Returns `settled` itself when
 * nothing is new, so a caller can keep it as state without re-rendering.
 */
export function settleGists(
  settled: ReadonlyMap<number, DigestGist>,
  incoming: readonly DigestGist[] | undefined,
): ReadonlyMap<number, DigestGist> {
  const fresh = (incoming ?? []).filter((g) => !settled.has(g.seq));
  if (fresh.length === 0) return settled;
  const next = new Map(settled);
  for (const g of fresh) next.set(g.seq, g);
  return next;
}

export function recentLadder(conversation: Conversation, gists: ReadonlyMap<number, DigestGist>): RecentLadder {
  const turns = turnsInOrder(conversation).filter((t) => t.text.trim().length > 0);
  const newest = turns.at(-1);
  const before = turns.at(-2);
  let last: RecentLadder["last"] = null;
  if (newest) {
    const page = spokenPage(newest.text, newest.voiced, LAST_WORDS);
    last = {
      seq: newest.seq,
      who: newest.who,
      text: page.words.map((w) => w.text).join(" "),
      cut: page.cut,
      words: page.words,
      spoken: newest.voiced !== undefined || newest.live === true,
    };
  }
  return {
    earlier: turns.slice(-(EARLIER_TURNS + 2), -2).map((t) => {
      const gist = gists.get(t.seq);
      return { seq: t.seq, who: t.who, text: gist?.one ?? localGist(t.text, 1), provisional: !gist };
    }),
    previous: before
      ? (() => {
          const gist = gists.get(before.seq);
          return {
            seq: before.seq,
            who: before.who,
            text: gist?.two ?? localGist(before.text, GIST_WORDS),
            provisional: !gist,
          };
        })()
      : null,
    last,
  };
}

/**
 * A turn in `n` words, without a model: the words that carry the most — a
 * number, a name, a long word — in the order they were said, and never a word
 * like "the" or "und". Crude next to the model's gist, and only until it comes.
 */
export function localGist(text: string, n: number): string {
  const words = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}€$%]+|[^\p{L}\p{N}€$%]+$/gu, ""))
    .filter(Boolean);
  const scored = words
    .map((word, i) => ({ word, i, score: weight(word, i) }))
    .filter((w) => w.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
    .sort((a, b) => a.i - b.i);
  if (scored.length === 0) return words.slice(0, n).join(" ") || "…";
  return scored.map((w) => w.word).join(" ");
}

function weight(word: string, index: number): number {
  const lower = word.toLowerCase();
  if (STOP.has(lower)) return 0;
  if (/\d/.test(word)) return 4;
  // A capital not at the start of the turn: a name, or a German noun.
  const capital = index > 0 && /^\p{Lu}/u.test(word) ? 1.5 : 0;
  return 1 + capital + Math.min(word.length, 12) / 6;
}

/** Words that never carry a turn, in the two languages the drives are in. */
const STOP = new Set(
  `a an the and or but so if then than that this these those there here it its it's is are was were be been being
   am do does did done have has had having i i'm i've i'd you you're your yours we we're our us me my he she they them
   their his her to of in on at by for from with about as into over up down out not no yes yeah okay ok oh um uh hm hmm
   just really very quite maybe also too well right like what which who whom when where why how can could would should
   will shall may might must let let's lets get got go going gonna want think know mean sure thing things something
   anything everything some any all more most much many one ones now actually basically kind sort
   der die das den dem des ein eine einer eines einem einen und oder aber also dann wenn als wie was wer wo warum
   ich du er sie es wir ihr mir mich dir dich uns euch mein dein sein ihr unser ist sind war waren bin bist sein habe hast
   hat haben hatte nicht kein keine ja nein noch schon auch nur mal doch so zu im in am an auf aus bei mit nach von vor
   für über um zum zur dass das hier da jetzt okay genau eigentlich vielleicht einfach ganz sehr kann können muss
   würde wäre soll will etwas alles man`.split(/\s+/),
);
