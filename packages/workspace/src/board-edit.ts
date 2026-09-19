/**
 * One edit to the board, planned as the ops that carry it out.
 *
 * Two callers write to the board, and they must write the SAME ops for the
 * same intent, or the measurement compares two different things: the board
 * page (a person dragging a card or tapping "not a task", `via: "user"`), and
 * the talk-back agent acting on a spoken request through a tool
 * (`via: "agent"`). Both plan here; each only authenticates, appends and
 * reports.
 *
 * The shapes are the ones the board route has always written:
 * - a MOVE is a `revise_block` that keeps the text and the spans — the card
 *   keeps its speech provenance — and changes only the state;
 * - a REWORD is the same op keeping the state and changing the text;
 * - "NOT A TASK" is a `retire_block`;
 * - an ADD is an `add_block` of kind `task` with no spans, since no utterance
 *   said it in these words, preceded by a `create_topic` when the topic it
 *   names does not exist yet.
 *
 * Idempotent by construction: every new id is derived from the caller's
 * `opId`, so a request retried after a dropped connection plans the same rows
 * and the database's primary key turns the second append into a no-op.
 *
 * Pure: no I/O, no model call, no database.
 */
import { foldBoard, type Board, type BoardCard, type TaskTransition } from "./board";
import { deterministicId } from "./extract";
import { foldWorkspace, headOf, rootOf } from "./fold";
import type { OpVia, StoredOp, TaskState, WorkspaceOp, WorkspaceState } from "./types";

export type BoardEdit =
  | { action: "move"; state: TaskState }
  | { action: "retire" }
  | { action: "reword"; text: string }
  | { action: "add"; text: string; topic: string; state?: TaskState };

/**
 * Which card an edit is aimed at.
 *
 * The board page knows the block it drew (`blockId`), which may since have
 * been revised — the gesture lands on whatever block the card now is. The
 * agent knows only what its context showed it: a short `handle` per card.
 */
export type CardTarget = { blockId: string } | { handle: string };

export interface PlannedCard {
  cardId: string;
  handle: string;
  /** The head block after the edit — the id a later edit should aim at. */
  blockId: string;
  text: string;
  state: TaskState | "retired";
  topicTitle: string;
}

export type PlannedEdit =
  | {
      status: "apply";
      /** Rows to append, in order, each with its idempotent row id. */
      ops: { id: string; op: WorkspaceOp }[];
      card: PlannedCard;
      /** Where the card was before, or null for an add. */
      from: TaskState | null;
      /** The card's last transition before this edit, for analytics. */
      previous: TaskTransition | null;
      /** Every transition on the card before this edit, oldest first. */
      history: TaskTransition[];
    }
  | { status: "unchanged" | "exists"; card: PlannedCard }
  | { status: "not_found" | "ambiguous" | "not_a_task" | "invalid"; reason: string };

/** Longest task text accepted from an edit: a task is a line, not a paragraph. */
export const MAX_TASK_TEXT = 200;

/**
 * The short name a card goes by in the agent's context.
 *
 * The LAST six hex digits of the card's root id, not the first: every id is
 * UUID-shaped, but fixture ids share a long zero prefix, and deterministic ids
 * are hashes whose tail is as random as their head. Six digits is 16 million
 * values against a board of dozens; a collision is refused as `ambiguous`
 * rather than guessed at.
 */
export function cardHandle(cardId: string): string {
  return cardId.replace(/[^0-9a-f]/gi, "").slice(-6).toLowerCase();
}

/**
 * Whether two task lines say the same thing.
 *
 * Exported because both writers that can put a NEW card on the board have to
 * refuse the same duplicates: the agent's `add_task` and an import of a board
 * the person already keeps. Punctuation and case are ignored, so "Email
 * William." and "email William" are one task.
 */
export function sameTaskText(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.!?,;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return norm(a) === norm(b);
}

function view(card: BoardCard, overrides: Partial<PlannedCard> = {}): PlannedCard {
  return {
    cardId: card.cardId,
    handle: cardHandle(card.cardId),
    blockId: card.block.id,
    text: card.block.text,
    state: card.state,
    topicTitle: card.topic.title,
    ...overrides,
  };
}

export function planBoardEdit(
  ops: readonly StoredOp[],
  edit: BoardEdit,
  opts: { via: OpVia; opId: string; target?: CardTarget },
): PlannedEdit {
  const workspace = foldWorkspace(ops);
  const board = foldBoard(ops);

  if (edit.action === "add") return planAdd(board, workspace, edit, opts);
  if (!opts.target) return { status: "invalid", reason: "this edit needs a card" };

  const found = findCard(board, workspace, opts.target);
  if (!("card" in found)) return found;
  const { card } = found;

  const history = board.transitions.filter((t) => t.cardId === card.cardId);
  const previous = history.at(-1) ?? null;
  const head = card.block;

  if (edit.action === "retire") {
    return {
      status: "apply",
      ops: [{ id: opts.opId, op: { type: "retire_block", blockId: head.id, via: opts.via } }],
      card: view(card, { state: "retired" }),
      from: card.state,
      previous,
      history,
    };
  }

  const text = edit.action === "reword" ? edit.text.trim().slice(0, MAX_TASK_TEXT) : head.text;
  const state = edit.action === "move" ? edit.state : card.state;
  if (!text) return { status: "invalid", reason: "a task needs words" };

  // Moving a card to the column it is already in, or rewording it to what it
  // already says, is not an edit — and recording one would put a phantom
  // transition in the measurement.
  if (state === card.state && text === head.text) {
    return { status: "unchanged", card: view(card) };
  }

  return {
    status: "apply",
    ops: [
      {
        id: opts.opId,
        op: {
          type: "revise_block",
          // The op id doubles as the new block id: one key, idempotent for both.
          blockId: opts.opId,
          supersedesBlockId: head.id,
          topicId: head.topicId,
          kind: "task",
          text,
          spans: head.spans,
          state,
          via: opts.via,
        },
      },
    ],
    card: view(card, { blockId: opts.opId, text, state }),
    from: card.state,
    previous,
    history,
  };
}

function findCard(
  board: Board,
  workspace: WorkspaceState,
  target: CardTarget,
): { card: BoardCard } | { status: "not_found" | "ambiguous" | "not_a_task"; reason: string } {
  if ("handle" in target) {
    const handle = target.handle.replace(/^#/, "").trim().toLowerCase();
    const matches = board.cards.filter((c) => cardHandle(c.cardId) === handle);
    if (matches.length === 0) return { status: "not_found", reason: `no card ${handle} on the board` };
    if (matches.length > 1) return { status: "ambiguous", reason: `more than one card is ${handle}` };
    return { card: matches[0]! };
  }

  // By block: whichever card that block's revision chain belongs to now. A
  // block that is not a live task — a claim, or a retired card — is refused
  // rather than resurrected.
  const block = workspace.allBlocks.get(target.blockId);
  if (!block) return { status: "not_found", reason: "no such block" };
  const head = headOf(workspace.allBlocks, target.blockId) ?? block;
  const cardId = rootOf(workspace.allBlocks, head.id);
  const card = board.cards.find((c) => c.cardId === cardId);
  if (!card) return { status: "not_a_task", reason: "that block is not a card on the board" };
  return { card };
}

function planAdd(
  board: Board,
  workspace: WorkspaceState,
  edit: Extract<BoardEdit, { action: "add" }>,
  opts: { via: OpVia; opId: string },
): PlannedEdit {
  const text = edit.text.trim().slice(0, MAX_TASK_TEXT);
  const topicTitle = edit.topic.trim().slice(0, 80);
  if (!text) return { status: "invalid", reason: "a task needs words" };
  if (!topicTitle) return { status: "invalid", reason: "a task needs a topic" };

  // Said twice, added once. The extractor may already have put the same task
  // on the board from the same speech; a second card for it is noise the
  // person has to clean up.
  const duplicate = board.cards.find(
    (c) => sameTaskText(c.block.text, text) && c.state !== "done" && c.state !== "dropped",
  );
  if (duplicate) return { status: "exists", card: view(duplicate) };

  // Live topics only: a merged-away topic is not a home for new work.
  const existing = workspace.topics.find((t) => t.title.toLowerCase() === topicTitle.toLowerCase());
  const topicId = existing?.id ?? deterministicId("agent-topic", opts.opId);
  const state = edit.state ?? "open";

  const planned: { id: string; op: WorkspaceOp }[] = [];
  if (!existing) {
    planned.push({ id: topicId, op: { type: "create_topic", topicId, title: topicTitle, via: opts.via } });
  }
  planned.push({
    id: opts.opId,
    op: { type: "add_block", blockId: opts.opId, topicId, kind: "task", text, state, via: opts.via, spans: [] },
  });

  return {
    status: "apply",
    ops: planned,
    card: {
      cardId: opts.opId,
      handle: cardHandle(opts.opId),
      blockId: opts.opId,
      text,
      state,
      topicTitle: existing?.title ?? topicTitle,
    },
    from: null,
    previous: null,
    history: [],
  };
}
