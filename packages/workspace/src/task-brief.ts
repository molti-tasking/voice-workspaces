/**
 * The briefing behind a card.
 *
 * A card on `/board` carries a sentence and a marker line. That is enough to
 * recognise a task and nowhere near enough to start on one: what was actually
 * said, how the card reached the column it is in, and what else is known about
 * the topic all sit in the ledger, one fold away, and today they are only
 * reachable by reading `/timeline` back.
 *
 * This assembles them — from the record alone. No model call, no stored
 * summary, nothing that could be invented. A brief is the card's revision
 * chain, the utterances those revisions cite, and the topic's other blocks,
 * rearranged for reading.
 *
 * ## Quotes come from spans, not from `sourceUtteranceIds`
 *
 * They look interchangeable and are not. `appendOps` fills a row's
 * `sourceUtteranceIds` with the whole extraction batch when the op itself
 * carries no spans (packages/db/src/workspace.ts), so quoting from it would
 * put unrelated speech under a task. A block's `spans` are the model's own
 * claim about which utterance this text came from, which is the thing being
 * shown. Where there are none, the brief says so rather than guessing.
 *
 * ## And only from SPEECH steps
 *
 * A board move copies the head block's spans onto the new block, so it reads
 * as though the person's drag cited the speech behind the wording it replaced.
 * It did not: the person said nothing. Only steps the extractor made quote.
 *
 * Pure: no I/O, no model call, no database.
 */
import type { Board, BoardCard, TransitionVia, TaskTransition } from "./board";
import { headOf, rootOf } from "./fold";
import type { Block, TaskState, Topic } from "./types";

/** One block in a card's revision chain, and what put it there. */
export interface CardStep {
  block: Block;
  via: TransitionVia;
  /** Absent when the step only sharpened the wording — the card did not move. */
  transition?: TaskTransition;
  /** The wording this step replaced, when it changed. */
  previousText?: string;
  /** Utterances this step cites. Empty for anything but a speech step. */
  utteranceIds: string[];
}

export interface CardBrief {
  card: BoardCard;
  /** Oldest first: the card's life, read forwards. */
  steps: CardStep[];
  /** Every utterance the chain cites, deduped, in the order first cited. */
  utteranceIds: string[];
}

/** What else is known about the topic a card sits on. */
export interface TopicContext {
  topic: Topic;
  /** What is still owed, first — as on the workspace card. */
  questions: Block[];
  /** Claims, facts, then the asides. */
  notes: Block[];
  /** Every task on the topic, the active ones first. */
  tasks: BoardCard[];
}

export interface TopicBrief extends TopicContext {
  /** The active cards, briefed. Done and dropped tasks stay in `tasks` only. */
  cards: CardBrief[];
}

/**
 * Reading order for a column, most urgent first.
 *
 * Not the board's left-to-right order: a brief is read to decide what to do
 * next, so what is in flight comes before what is queued, and what is finished
 * comes last.
 */
const STATE_ORDER: Record<TaskState, number> = {
  doing: 0,
  next: 1,
  open: 2,
  done: 3,
  dropped: 4,
};

/** The columns a brief covers. Done and dropped are not work to start on. */
const ACTIVE_STATES: readonly TaskState[] = ["doing", "next", "open"];

/** Asides last, as on the workspace card: substance, attributes, then prose. */
const NOTE_KINDS: readonly Block["kind"][] = ["claim", "fact", "context", "meta"];

/** A bound on every walk over a model-derived chain. Cycles must not hang a page. */
const MAX_CHAIN = 64;

/**
 * The live card an id names, whatever revision of it the id is.
 *
 * A URL outlives the block it was minted from: every move rewrites the head,
 * so yesterday's link would 404 on a card that is merely one drag older.
 * Following the chain to its head and back to its root resolves both ends.
 *
 * Returns nothing for a retired card, a block that is not a task, and an id
 * that names nothing — all of which the route turns into a 404.
 */
export function cardFor(board: Board, id: string): BoardCard | undefined {
  const head = headOf(board.workspace.allBlocks, id);
  if (!head) return undefined;
  const cardId = rootOf(board.workspace.allBlocks, head.id);
  return board.cards.find((c) => c.cardId === cardId);
}

/**
 * One card's brief: every wording it has had, and what each cited.
 *
 * Steps follow the revision chain rather than `card.history`, because the
 * chain has one entry per op and the history only has the ones that moved the
 * card. A rewording that did not move it is still something that happened to
 * the task, and a brief that skipped it would show text appearing from nowhere.
 */
export function briefCard(board: Board, card: BoardCard): CardBrief {
  const blocks = chainOf(board, card);

  const steps = blocks.map((block): CardStep => {
    // A retire ends the card, so it is never a step in a live one; excluded
    // here so a retire and a move on the same block cannot be confused.
    const transition = card.history.find((t) => t.blockId === block.id && t.to !== "retired");
    const previous = block.supersedes
      ? board.workspace.allBlocks.get(block.supersedes)
      : undefined;
    const via: TransitionVia = transition?.via ?? block.via ?? "speech";

    return {
      block,
      via,
      transition,
      previousText:
        previous && previous.text !== block.text ? previous.text : undefined,
      // See the note at the top: a move carries the head's spans forwards, and
      // attributing them to the person who dragged it would be a fabrication.
      utteranceIds: via === "speech" ? block.spans.map((s) => s.utteranceId) : [],
    };
  });

  const utteranceIds: string[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    for (const id of step.utteranceIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      utteranceIds.push(id);
    }
  }

  return { card, steps, utteranceIds };
}

/**
 * The card's blocks, oldest first.
 *
 * Walks `supersedes` back from the head — which is where the card's identity
 * is anchored — rather than forwards from the root, because `supersededById`
 * can fork when a board move and an extraction race, while the backwards chain
 * from the visible head is single by construction.
 */
function chainOf(board: Board, card: BoardCard): Block[] {
  const blocks: Block[] = [];
  const seen = new Set<string>();
  let cursor: Block | undefined = card.block;

  while (cursor && blocks.length < MAX_CHAIN && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    blocks.push(cursor);
    if (cursor.id === card.cardId) break;
    cursor = cursor.supersedes ? board.workspace.allBlocks.get(cursor.supersedes) : undefined;
  }

  return blocks.reverse();
}

/**
 * What else has been said about the topic this card sits on.
 *
 * Read off the same fold the board was built from, so it cannot disagree with
 * `/workspace` about what is currently thought. Superseded and retired blocks
 * are already gone from `blocksByTopic`; a topic merged away resolves to the
 * one that absorbed it, so its blocks appear under the surviving title.
 */
export function topicContext(board: Board, topic: Topic): TopicContext {
  const blocks = board.workspace.blocksByTopic.get(topic.id) ?? [];

  const notes: Block[] = [];
  for (const kind of NOTE_KINDS) {
    for (const block of blocks) if (block.kind === kind) notes.push(block);
  }

  return {
    topic,
    questions: blocks.filter((b) => b.kind === "question"),
    notes,
    tasks: board.cards
      .filter((c) => c.topic.id === topic.id)
      .sort(byUrgencyThenRecency),
  };
}

/**
 * Every active task, grouped by topic.
 *
 * Cards are sorted first and grouped second, so the most urgent card places
 * its topic: the topic holding the one thing in `doing` leads the page, rather
 * than whichever topic happens to have been touched last. Done and dropped
 * cards are left out — this answers "what should I start on", and the finished
 * ones are still reachable through `topicContext().tasks`.
 */
export function briefBoard(board: Board): TopicBrief[] {
  const active = board.cards
    .filter((c) => ACTIVE_STATES.includes(c.state))
    .sort(byUrgencyThenRecency);

  const order: Topic[] = [];
  const byTopic = new Map<string, BoardCard[]>();
  for (const card of active) {
    const list = byTopic.get(card.topic.id);
    if (list) list.push(card);
    else {
      order.push(card.topic);
      byTopic.set(card.topic.id, [card]);
    }
  }

  return order.map((topic) => ({
    ...topicContext(board, topic),
    cards: (byTopic.get(topic.id) ?? []).map((card) => briefCard(board, card)),
  }));
}

/** Doing, next, open, done, dropped — then most recently moved within each. */
function byUrgencyThenRecency(a: BoardCard, b: BoardCard): number {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    b.lastTransition.at.getTime() - a.lastTransition.at.getTime() ||
    b.lastTransition.seq - a.lastTransition.seq
  );
}
