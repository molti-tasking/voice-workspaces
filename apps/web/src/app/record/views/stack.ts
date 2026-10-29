// The `/digest` subpath, not the package index: the index pulls in server code.
import { stripFillers } from "@voicemural/shared";
import { GIST_LINE_WORDS, type ConversationDigest, type DigestGist } from "@voicemural/talkback/digest";
import type { Conversation, Mark, Section, Speaker, Turn } from "@/lib/talkback/conversation";
import { turnsInOrder } from "@/lib/talkback/cursor";
import { spokenPage, type SpokenWord } from "@/lib/talkback/spoken";

/**
 * What the Stack view draws, as data: the conversation as a stack of topics.
 *
 * - `current`: the topic being talked about, the largest bubble, with what
 *   was decided on it so far;
 * - `previous`: the turn before the newest, as a short line, with who said it
 *   — only while it was said on the current topic, so right after a return
 *   the line from the topic just left does not stand under the one come back;
 * - `lookup`: the search the agent ran for this exchange, when it ran one;
 * - `live`: the newest turn's last words, as they come;
 * - `slots`: every earlier topic, each with its decision, in the order they
 *   first came up. A topic keeps its slot for the rest of the conversation:
 *   while it is the current one again, its slot is a `gap`, so nothing else
 *   on the shelf moves (DG3) and the topic has a place to go back to.
 *
 * HOW MANY FIT is the view's business, not the model's: the shelf shows as
 * many earlier topics as its height holds (`arrangeShelf`), first as full
 * bubbles, then as smaller ones with their names only, and only past that
 * groups the oldest into clusters, each a bubble that holds several topics.
 *
 * NO LABELS. Nothing here is a status word ("open", "2nd visit"): the topics
 * carry their decisions, and a return shows in the motion (`stack-view.tsx`).
 *
 * WHOSE WORDS (DG6). A topic is marked as mostly theirs or mostly the agent's
 * when one side said at least `WHOSE_SHARE` of its words; otherwise both.
 *
 * Pure, so the view and its test read the same thing.
 */

/** The most of the newest turn shown at once: a page of its sentence. */
export const STACK_LIVE_WORDS = 14;
/** The same on a short screen, where the current topic's bubble is smaller. */
export const STACK_LIVE_WORDS_TIGHT = 9;
/** At most this many clusters; past it, clusters merge two into one. */
export const STACK_MAX_CLUSTERS = 4;
/** The fewest topics a cluster holds. */
export const STACK_CLUSTER_MIN = 4;
/** One side's share of a topic's words for the topic to count as theirs. */
export const WHOSE_SHARE = 0.65;

export type Whose = Speaker | "both";

export interface StackTopic {
  key: string;
  ordinal: number | null;
  title: string;
  /** What was decided on it, as the digest wrote it; null before anything was. */
  decision: string | null;
  whose: Whose;
}

export type StackSlot = { kind: "topic"; topic: StackTopic } | { kind: "gap"; topic: StackTopic };

export interface StackLine {
  seq: number;
  who: Speaker;
  text: string;
  /** Cut here, not yet worded by the model: drawn lighter until its line comes. */
  provisional: boolean;
}

/**
 * The words being said: the sentence they are in — or of a long one, its run
 * of `STACK_LIVE_WORDS` — as a page that the next replaces whole, so no word
 * moves while it is read (lib/talkback/spoken.ts).
 */
export interface StackLive {
  seq: number;
  who: Speaker;
  words: SpokenWord[];
  /** The page starts inside a sentence, not at its start. */
  cut: boolean;
  /** Still being said — the agent's voice, or their live words: words fade in as they come. */
  spoken: boolean;
}

export interface StackLookup {
  key: string;
  query: string;
  /** What came back, in a few words; null while it runs. */
  found: string | null;
}

export interface StackModel {
  current: StackTopic | null;
  /** Every earlier topic's slot, oldest first, the newest nearest the current topic. */
  slots: StackSlot[];
  previous: StackLine | null;
  lookup: StackLookup | null;
  live: StackLive | null;
}

function whose(section: Section): Whose {
  let user = 0;
  let agent = 0;
  for (const turn of section.turns) {
    const n = turn.text.trim() ? turn.text.trim().split(/\s+/).length : 0;
    if (turn.who === "user") user += n;
    else agent += n;
  }
  const all = user + agent;
  if (all === 0) return "both";
  if (user / all >= WHOSE_SHARE) return "user";
  if (agent / all >= WHOSE_SHARE) return "agent";
  return "both";
}

/** Openers that say nothing at a glance: "Okay, so", "Well", "Right then". */
const OPENERS = /^(?:(?:okay|ok|so|well|right|alright|all right|yeah|yes|hmm|and|but|now|then|great|cool|sure)\b[,.!]?\s*)+/i;

/**
 * The part of a turn worth a glance, until the model's gist comes: the last
 * question it asks — what the answer to it answers — or else its last
 * sentence, with fillers and openers left out, cut with the same margin the
 * model's lines are kept to (`GIST_LINE_WORDS` and two).
 */
export function keyLine(text: string): string {
  const sentences = (stripFillers(text).match(/[^.!?…]+[.!?…]*/g) ?? []).map((s) => s.trim().replace(OPENERS, "")).filter(Boolean);
  const key = sentences.findLast((s) => s.endsWith("?")) ?? sentences.at(-1) ?? text.trim();
  const words = key.split(/\s+/);
  const max = GIST_LINE_WORDS + 2;
  const line = words.slice(0, max).join(" ").replace(/[,;:]$/, "");
  const shown = words.length > max ? `${line}…` : line;
  return shown.charAt(0).toUpperCase() + shown.slice(1);
}

/** A turn as a short line: the model's, or its key sentence until that comes. */
export function turnLine(turn: Turn, gist: DigestGist | undefined): StackLine {
  if (gist?.line)
    return {
      seq: turn.seq,
      who: turn.who,
      text: gist.line,
      provisional: false,
    };
  return {
    seq: turn.seq,
    who: turn.who,
    text: keyLine(turn.text),
    provisional: true,
  };
}

/**
 * The stack at this point. `currentKey` is the topic the view shows as
 * current, which may lag the conversation's for the moment a return is cued;
 * the conversation's own by default.
 */
export function stackModel(
  conversation: Conversation,
  digest: ConversationDigest,
  gists: ReadonlyMap<number, DigestGist>,
  currentKey: string | null = conversation.current,
  liveWords: number = STACK_LIVE_WORDS,
): StackModel {
  const decisions = new Map(digest.topics.map((t) => [t.ordinal, t.decision ?? null]));
  const topicOf = (section: Section): StackTopic => ({
    key: section.key,
    ordinal: section.ordinal ?? null,
    title: section.title ?? "",
    decision: section.ordinal !== undefined ? (decisions.get(section.ordinal) ?? null) : null,
    whose: whose(section),
  });

  const named = conversation.sections.filter((s) => s.title !== null);
  const currentSection = named.find((s) => s.key === currentKey) ?? null;
  // Every named topic but the current one has been left; the current one has
  // a slot only once it has been left and come back to.
  const all: StackSlot[] = named.flatMap((s): StackSlot[] => {
    if (s !== currentSection) return [{ kind: "topic", topic: topicOf(s) }];
    return (s.visits ?? 1) > 1 ? [{ kind: "gap", topic: topicOf(s) }] : [];
  });

  const turns = turnsInOrder(conversation).filter((t) => t.text.trim().length > 0);
  const sectionOf = new Map<number, string>();
  for (const s of conversation.sections) for (const t of s.turns) sectionOf.set(t.seq, s.key);
  const newest = turns.at(-1) ?? null;
  const before = turns.at(-2) ?? null;

  // The search for this exchange: run after their turn, before or while the answer comes.
  const lastLookup = conversation.marks.filter((m): m is Extract<Mark, { kind: "lookup" }> => m.kind === "lookup").at(-1);
  let previousTurn: Turn | null = before;
  let liveTurn: Turn | null = newest;
  let lookup: StackLookup | null = null;
  if (lastLookup && newest) {
    if (newest.who === "user" && lastLookup.after === newest.seq) {
      // Searching for their question: it is the line answered, and nothing is being said.
      previousTurn = newest;
      liveTurn = null;
      lookup = lastLookup;
    } else if (newest.who === "agent" && before && lastLookup.after === before.seq) {
      lookup = lastLookup;
    }
  }

  let live: StackLive | null = null;
  if (liveTurn) {
    const page = spokenPage(liveTurn.text, liveTurn.voiced, liveWords);
    live = {
      seq: liveTurn.seq,
      who: liveTurn.who,
      words: page.words,
      cut: page.midSentence,
      spoken: liveTurn.voiced !== undefined || liveTurn.live === true,
    };
  }
  const previous =
    previousTurn && currentSection && sectionOf.get(previousTurn.seq) === currentSection.key
      ? turnLine(previousTurn, gists.get(previousTurn.seq))
      : null;

  return {
    current: currentSection ? topicOf(currentSection) : null,
    slots: all,
    previous,
    lookup: lookup ? { key: lookup.key, query: lookup.query, found: lookup.found } : null,
    live,
  };
}

/** Several of the oldest topics, shown as one bubble that holds them. */
export interface StackCluster {
  /** Stable while its topics stay together: the key of its first topic. */
  key: string;
  topics: StackTopic[];
}

export interface ShelfArrangement {
  /** The oldest topics, grouped, oldest group first. */
  clusters: StackCluster[];
  /** The newest topics, each in its own slot. */
  slots: StackSlot[];
}

/**
 * The shelf with only the newest `named` slots shown one by one and the rest
 * grouped into clusters.
 *
 * CLUSTERS HOLD STILL. A cluster is a run of topics in the order they came
 * up, counted from the first one, so a topic that joins the clusters joins the
 * last of them and the others keep their topics. Clusters are
 * `STACK_CLUSTER_MIN` topics each, doubled (4, 8, 16, …) whenever there would
 * be more than `maxClusters` (`STACK_MAX_CLUSTERS`, fewer on a shelf too
 * short for them): then neighbours merge two into one, and a hundred topics
 * still make at most four bubbles. A topic come back to is in
 * the large bubble; its slot stays in its cluster, which is where it goes back.
 */
export function arrangeShelf(
  slots: StackSlot[],
  named: number,
  maxClusters: number = STACK_MAX_CLUSTERS,
): ShelfArrangement {
  const keep = Math.max(0, Math.min(named, slots.length));
  const older = slots.slice(0, slots.length - keep);
  const shown = slots.slice(slots.length - keep);
  if (older.length === 0) return { clusters: [], slots: shown };
  let size = STACK_CLUSTER_MIN;
  while (Math.ceil(older.length / size) > Math.max(1, maxClusters)) size *= 2;
  const clusters: StackCluster[] = [];
  for (let i = 0; i < older.length; i += size) {
    const topics = older.slice(i, i + size).map((s) => s.topic);
    clusters.push({ key: `cluster:${topics[0]!.key}`, topics });
  }
  return { clusters, slots: shown };
}

/**
 * A cluster's name, short enough for two side by side: the first word of its
 * first and its last topic, in the order they came up ("Friday – Hotel"). The
 * circle beside it says how many it holds.
 */
export function clusterLabel(topics: StackTopic[]): string {
  const word = (t: StackTopic | undefined) => t?.title.split(" ")[0] ?? "";
  if (topics.length <= 1) return word(topics[0]);
  return `${word(topics[0])} – ${word(topics.at(-1))}`;
}
