/**
 * The task board, rendered for the agent that is talking to you.
 *
 * WHY THIS EXISTS. The board and the conversation were two systems that did not
 * know about each other. `foldBoard` turns the op log into what the person has
 * said they would do; the live agent got `passages` (dated transcript quotes)
 * and `threads` (prose distilled from past sessions) and nothing else. So asked
 * "what should I work on next", it could only guess from quotes — it could not
 * name a task, could not say which column one sat in, and could not notice that
 * something had gone untouched for three drives. That is not a prompt problem
 * and no amount of "be more proactive" fixes it.
 *
 * SIGHT, AND NOW A HANDLE TO ACT WITH. Nothing here writes, but the agent can:
 * its board tools (BOARD_TOOLS) move, add, reword and drop cards, and their
 * ops carry `via: "agent"` as a third category alongside `speech` and `user`,
 * so `judge()` scores them separately rather than having them contaminate the
 * speech-versus-person comparison the study rests on. So each card now carries
 * the short handle those tools take (`cardHandle`), and the topics are listed,
 * because a task added by voice has to land in one. The prompt keeps the
 * handles out of speech.
 *
 * Pure apart from the fold it is handed. No I/O here — the caller loads the ops.
 */
import {
  cardHandle,
  foldBoard,
  foldWorkspace,
  type Board,
  type BoardCard,
  type StoredOp,
} from "@voicemural/workspace";
import { trimToBudget } from "./budget";

/**
 * How much of the turn the board may take.
 *
 * Prompt size moves LLM time-to-first-token more than anything else on this
 * path — measured at 0.36s on a short prompt against 2.2s with full recall — so
 * the board is budgeted like every other section rather than sent whole. A
 * board of forty cards would otherwise quietly double the pre-first-token cost
 * of every turn for the sake of thirty cards nobody asked about.
 */
export const MAX_BOARD_CHARS = 1100;

/** Most topics named for a new task to land in; the most recently touched first. */
const MAX_TOPICS = 8;

/** Untouched for this many drives before it is worth mentioning unprompted. */
const STALE_AFTER_SESSIONS = 2;

/**
 * The columns the agent is shown, in the order it should care about them.
 *
 * `done` and `dropped` are omitted. They are the largest columns on any board
 * that has been running a while and the least use in a conversation about what
 * to do next — and the person asking "what did I finish" is asking a question
 * `passages` already answers from what they actually said.
 */
const LIVE_COLUMNS = ["doing", "next", "open"] as const;

export interface BoardContext {
  /** Rendered block. Null only when the board is not being shown at all. */
  text: string | null;
  /** For the analytics on the route — how much of the board was shown. */
  shown: number;
  total: number;
}

/**
 * One line per task: the column, the task, the handle to act on it with, its
 * topic, and how long it has sat.
 *
 * Deliberately flat and short. This competes for the same prompt budget as
 * recall, and a task is a sentence — it needs no structure beyond the column
 * it is in.
 */
function renderCard(card: BoardCard): string {
  const notes = [`card ${cardHandle(card.cardId)}`, card.topic.title];
  if (card.staleSessions >= STALE_AFTER_SESSIONS) {
    notes.push(`untouched for ${card.staleSessions} drives`);
  }
  return `- [${card.state}] ${card.block.text} (${notes.join(" · ")})`;
}

/**
 * Fold the ledger and render the live board.
 *
 * Ordered `doing` → `next` → `open`, and within a column by most recently
 * moved, which is `foldBoard`'s own order: the card that just changed is the
 * one a conversation is most likely to be about.
 */
export function buildBoardContext(ops: readonly StoredOp[]): BoardContext {
  const board: Board = foldBoard(ops);
  const topics = foldWorkspace(ops)
    .topics.slice(0, MAX_TOPICS)
    .map((t) => t.title);
  const topicLine = topics.length ? `\nTheir topics: ${topics.join(" · ")}` : "";

  const live = LIVE_COLUMNS.flatMap((state) => board.columns[state]);
  const kept = trimToBudget(live.map(renderCard), MAX_BOARD_CHARS);

  // An empty board is still a board: the agent can add to it, and "nothing is
  // open" is the answer to "what's on my board" rather than silence about it.
  return {
    text: kept.length
      ? `Their task board right now:\n${kept.join("\n")}${topicLine}`
      : `Their task board right now: nothing open.${topicLine}`,
    shown: kept.length,
    total: board.cards.length,
  };
}
