/**
 * The task board: a third fold over the same op log.
 *
 * The workspace answers "what do I currently think about X"; the trajectory
 * answers "how did I get here". This answers "what have I said I would do, and
 * where does each of those stand" — with the columns being the tenses of the
 * speech that last mentioned each task: open, next, doing, done, dropped.
 *
 * Like the trajectory, nothing here is stored. A task is a block of kind
 * `task`, its column is the `state` on that block, and a transition is a
 * `revise_block` that changed the state. Speech moves cards through the
 * extractor; a person moves them through the board. Both are ops in the same
 * ledger, told apart by `via`.
 *
 * The evaluation's primary measure falls out of that: for every speech-driven
 * transition, did the person keep it, reverse it, or never touch it. Nobody
 * reads the drives, so the person's own keep/reverse is the ground truth by
 * design — and it is read off the ledger, not off page views.
 *
 * Pure: no I/O, no model call, no database.
 */
import { foldWorkspace, headOf, rootOf } from "./fold";
import { bucketBoundaries, type Bucket } from "./trajectory";
import {
  TaskState,
  type Block,
  type StoredOp,
  type Topic,
  type WorkspaceOp,
  type WorkspaceState,
} from "./types";

export type TransitionVia = "speech" | "user";

export interface TaskTransition {
  /** Root of the revision chain — stable across revisions, the card's identity. */
  cardId: string;
  /** The block that carried the new state. */
  blockId: string;
  /** Null on the first add. */
  from: TaskState | null;
  to: TaskState | "retired";
  at: Date;
  seq: number;
  via: TransitionVia;
  extractionId?: string;
  captureSessionId?: string;
  sourceUtteranceIds: string[];
}

export interface BoardCard {
  cardId: string;
  block: Block;
  topic: Topic;
  state: TaskState;
  lastTransition: TaskTransition;
  /** Every transition on this card, oldest first. */
  history: TaskTransition[];
  /** Drives recorded since the card last moved, not counting the one that moved it. */
  staleSessions: number;
}

/** A capture session as it appears in the ledger, for "sessions since" counts. */
export interface LedgerSession {
  id: string;
  /** The last op the session contributed. Later than this seq is "after the drive". */
  lastSeq: number;
}

export interface Board {
  columns: Record<TaskState, BoardCard[]>;
  cards: BoardCard[];
  /** Every transition on every card, in ledger order. */
  transitions: TaskTransition[];
  sessions: LedgerSession[];
  asOf: Date | null;
}

/* ---------------------------------------------------------------------------
 * Transitions
 * ------------------------------------------------------------------------- */

/**
 * Every state change in the ledger, in order.
 *
 * One pass over the seq-sorted ops against the fold's `allBlocks`, which has
 * already resolved states (inheritance, defaults) and revision chains. A
 * text-only revise — same state as the block it replaced — is not a
 * transition: the card did not move.
 */
export function transitionsOf(ops: readonly StoredOp[], asOf?: Date): TaskTransition[] {
  return transitionsFrom(foldWorkspace(ops, asOf), ops, asOf);
}

function transitionsFrom(
  state: WorkspaceState,
  ops: readonly StoredOp[],
  asOf?: Date,
): TaskTransition[] {
  const cutoff = asOf?.getTime();
  const relevant = ops
    .filter((o) => cutoff === undefined || o.occurredAt.getTime() <= cutoff)
    .slice()
    .sort((a, b) => a.seq - b.seq);

  const transitions: TaskTransition[] = [];
  /** Blocks already accounted for — the fold ignores a duplicated id, so must we. */
  const seen = new Set<string>();

  for (const stored of relevant) {
    const { op } = stored;
    let block: Block | undefined;
    let from: TaskState | null = null;
    let to: TaskState | "retired";

    switch (op.type) {
      case "add_block":
      case "revise_block": {
        block = state.allBlocks.get(op.blockId);
        if (!block || block.kind !== "task" || seen.has(block.id)) continue;
        seen.add(block.id);
        const previous = block.supersedes ? state.allBlocks.get(block.supersedes) : undefined;
        from = previous?.kind === "task" ? (previous.state ?? "open") : null;
        to = block.state ?? "open";
        // The wording sharpened but the card did not move.
        if (from === to) continue;
        break;
      }
      case "retire_block": {
        block = state.allBlocks.get(op.blockId);
        // The fold ignores a second retire; so does this.
        if (!block || block.kind !== "task" || seen.has(`retire:${block.id}`)) continue;
        if (block.retiredAt?.getTime() !== stored.occurredAt.getTime()) continue;
        seen.add(`retire:${block.id}`);
        from = block.state ?? "open";
        to = "retired";
        break;
      }
      default:
        continue;
    }

    transitions.push({
      cardId: rootOf(state.allBlocks, block.id),
      blockId: block.id,
      from,
      to,
      at: stored.occurredAt,
      seq: stored.seq,
      via: op.via === "user" ? "user" : "speech",
      extractionId: stored.extractionId,
      captureSessionId: stored.captureSessionId,
      sourceUtteranceIds: stored.sourceUtteranceIds ?? [],
    });
  }

  return transitions;
}

/* ---------------------------------------------------------------------------
 * The board
 * ------------------------------------------------------------------------- */

/**
 * Fold the ledger into a board.
 *
 * Every visible `task` block is a card, placed in the column its state names.
 * Columns read most recently moved first: the card that just changed is the
 * one worth checking.
 */
export function foldBoard(ops: readonly StoredOp[], opts: { asOf?: Date } = {}): Board {
  const state = foldWorkspace(ops, opts.asOf);
  const transitions = transitionsFrom(state, ops, opts.asOf);
  const sessions = ledgerSessions(ops, opts.asOf);

  const byCard = new Map<string, TaskTransition[]>();
  for (const t of transitions) {
    const list = byCard.get(t.cardId);
    if (list) list.push(t);
    else byCard.set(t.cardId, [t]);
  }

  const cards: BoardCard[] = [];
  for (const topic of state.topics) {
    for (const block of state.blocksByTopic.get(topic.id) ?? []) {
      if (block.kind !== "task") continue;
      const cardId = rootOf(state.allBlocks, block.id);
      const history = byCard.get(cardId) ?? [];
      const last = history[history.length - 1];
      if (!last) continue;
      cards.push({
        cardId,
        block,
        topic,
        state: block.state ?? "open",
        lastTransition: last,
        history,
        staleSessions: sessionsAfter(sessions, last),
      });
    }
  }

  const columns = emptyColumns();
  for (const card of cards) columns[card.state].push(card);
  for (const list of Object.values(columns)) {
    list.sort(
      (a, b) =>
        b.lastTransition.at.getTime() - a.lastTransition.at.getTime() ||
        b.lastTransition.seq - a.lastTransition.seq,
    );
  }

  return { columns, cards, transitions, sessions, asOf: state.asOf };
}

function emptyColumns(): Record<TaskState, BoardCard[]> {
  return { open: [], next: [], doing: [], done: [], dropped: [] };
}

/** Distinct capture sessions in the ledger, with the last op each contributed. */
function ledgerSessions(ops: readonly StoredOp[], asOf?: Date): LedgerSession[] {
  const cutoff = asOf?.getTime();
  const lastSeq = new Map<string, number>();
  for (const op of ops) {
    if (!op.captureSessionId) continue;
    if (cutoff !== undefined && op.occurredAt.getTime() > cutoff) continue;
    const seq = lastSeq.get(op.captureSessionId);
    if (seq === undefined || op.seq > seq) lastSeq.set(op.captureSessionId, op.seq);
  }
  return [...lastSeq.entries()]
    .map(([id, seq]) => ({ id, lastSeq: seq }))
    .sort((a, b) => a.lastSeq - b.lastSeq);
}

/**
 * Drives recorded after a transition — the opportunities to have reversed it.
 *
 * The drive that produced the transition does not count, whatever else it
 * appended afterwards. A user op has no session, so every later drive counts.
 */
function sessionsAfter(sessions: readonly LedgerSession[], t: TaskTransition): number {
  return sessions.filter((s) => s.lastSeq > t.seq && s.id !== t.captureSessionId).length;
}

/* ---------------------------------------------------------------------------
 * Acceptance — the measurement
 * ------------------------------------------------------------------------- */

export type TransitionOutcome =
  /** Untouched for at least `withinSessions` later drives. */
  | "kept"
  /** The person put it back where it was. */
  | "reversed"
  /** The person moved it, but somewhere else. */
  | "corrected"
  /** The person said it was not a task. */
  | "retired"
  /** Speech moved it again before the person weighed in. */
  | "superseded"
  /** Untouched, but not enough drives have passed to call it kept. */
  | "pending";

export interface JudgedTransition {
  transition: TaskTransition;
  outcome: TransitionOutcome;
  /** The transition that decided it, for everything but kept and pending. */
  decidedBy?: TaskTransition;
}

/**
 * Judge every speech transition by what happened to the card next.
 *
 * "Kept" is inferred from drives elapsed, not from page views: the ledger is
 * the instrument, and a card that sat in `done` through two more commutes
 * without being touched is one the person was content with. `sessions` should
 * be the board's own; without it the count falls back to the drives that
 * produced later transitions, which undercounts quiet ones.
 */
export function judge(
  transitions: readonly TaskTransition[],
  opts: { withinSessions: number; sessions?: readonly LedgerSession[] },
): JudgedTransition[] {
  const ordered = [...transitions].sort((a, b) => a.seq - b.seq);
  const sessions =
    opts.sessions ??
    ledgerSessions(
      ordered.map((t) => ({
        id: t.blockId,
        seq: t.seq,
        occurredAt: t.at,
        op: { type: "retire_block", blockId: t.blockId } as WorkspaceOp,
        captureSessionId: t.captureSessionId,
      })),
    );

  const judged: JudgedTransition[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const t = ordered[i]!;
    if (t.via !== "speech") continue;

    const next = ordered.slice(i + 1).find((n) => n.cardId === t.cardId);

    if (!next) {
      const elapsed = sessionsAfter(sessions, t);
      judged.push({ transition: t, outcome: elapsed >= opts.withinSessions ? "kept" : "pending" });
      continue;
    }

    let outcome: TransitionOutcome;
    if (next.via === "speech") outcome = "superseded";
    else if (next.to === "retired") outcome = "retired";
    else if (next.to === t.from) outcome = "reversed";
    else outcome = "corrected";

    judged.push({ transition: t, outcome, decidedBy: next });
  }

  return judged;
}

/** The speech transitions the person did not accept. */
export function reversals(
  transitions: readonly TaskTransition[],
  opts: { withinSessions: number; sessions?: readonly LedgerSession[] },
): JudgedTransition[] {
  return judge(transitions, opts).filter(
    (j) => j.outcome === "reversed" || j.outcome === "corrected" || j.outcome === "retired",
  );
}

/* ---------------------------------------------------------------------------
 * Over time
 * ------------------------------------------------------------------------- */

export interface ColumnDistribution {
  at: Date;
  counts: Record<TaskState, number>;
}

/** How many cards sat in each column at the end of every bucket. */
export function columnDistributionByBucket(
  ops: readonly StoredOp[],
  opts: { bucket?: Bucket } = {},
): ColumnDistribution[] {
  return bucketBoundaries(ops, opts.bucket ?? "session").map((at) => {
    const board = foldBoard(ops, { asOf: at });
    const counts = { open: 0, next: 0, doing: 0, done: 0, dropped: 0 };
    for (const s of TaskState.options) counts[s] = board.columns[s].length;
    return { at, counts };
  });
}

/* ---------------------------------------------------------------------------
 * For the worker
 * ------------------------------------------------------------------------- */

/**
 * What one extraction did to the board, before it is appended.
 *
 * `taskOps` is every op that touched a task; `taskTransitions` is the subset
 * that actually moved a card — a revise whose state differs from the block it
 * supersedes, or a retire. An add is a task op but not a transition: a new
 * card is a yield question, and a moved one is the acceptance question.
 */
export function taskOpStats(
  ops: readonly WorkspaceOp[],
  before: WorkspaceState,
): { taskOps: number; taskTransitions: number } {
  let taskOps = 0;
  let taskTransitions = 0;

  for (const op of ops) {
    switch (op.type) {
      case "add_block":
        if (op.kind === "task") taskOps += 1;
        break;
      case "revise_block": {
        if (op.kind !== "task") break;
        taskOps += 1;
        const previous = headOf(before.allBlocks, op.supersedesBlockId);
        const from = previous?.kind === "task" ? (previous.state ?? "open") : null;
        // An omitted state inherits, so it cannot be a move.
        const to = op.state ?? from ?? "open";
        if (from !== to) taskTransitions += 1;
        break;
      }
      case "retire_block": {
        const block = before.allBlocks.get(op.blockId);
        if (block?.kind === "task") {
          taskOps += 1;
          taskTransitions += 1;
        }
        break;
      }
      default:
        break;
    }
  }

  return { taskOps, taskTransitions };
}
