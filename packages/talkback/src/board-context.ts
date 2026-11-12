/**
 * Their tasks, rendered for the agent that is talking to them — by topic, the
 * way the conversation screen shows them.
 *
 * WHY THIS EXISTS. The task list and the conversation were two systems that did
 * not know about each other. `foldBoard` turns the op log into what the person
 * has said they would do; the live agent got `passages` (dated transcript
 * quotes) and `threads` (prose distilled from past sessions) and nothing else.
 * So asked "what should I work on next", it could only guess from quotes — it
 * could not name a task, could not say where one stood, and could not notice
 * that something had gone untouched for three drives. That is not a prompt
 * problem and no amount of "be more proactive" fixes it.
 *
 * BY TOPIC, NOT BY COLUMN (since the Stack, 2 Nov 2026). This used to be the
 * task board — doing, then next, then open, across every topic — because the
 * board was the screen tasks lived on. It is not any more: the conversation
 * screen is a stack of topics, and a topic's tasks are on its sheet, with
 * their state, beside what was said and decided on it. So the agent sees them
 * the same way: grouped under their topic, and the topics in the order the
 * conversation reaches them — the one whose sheet is open on their screen
 * first, then the ones this conversation has talked about, then the rest.
 * "What's left on this?" is about the topic in front of them, and the answer
 * is the first group rather than a search across columns.
 *
 * SIGHT, AND A HANDLE TO ACT WITH. Nothing here writes, but the agent can: its
 * task tools (BOARD_TOOLS) change a task's state, add, reword and remove
 * tasks, and their ops carry `via: "agent"` as a third category alongside
 * `speech` and `user`, so `judge()` scores them separately rather than having
 * them contaminate the speech-versus-person comparison the study rests on. So
 * each task carries the short handle those tools take (`cardHandle`), and the
 * topics with nothing open are named too, because a task added by voice has to
 * land in one. The prompt keeps the handles out of speech.
 *
 * Pure apart from the fold it is handed. No I/O here — the caller loads the ops.
 */
import {
  cardHandle,
  findTopic,
  foldBoard,
  topicsTouchedBy,
  type BoardCard,
  type StoredOp,
  type Topic,
} from "@voicemural/workspace";

/**
 * How much of the turn their tasks may take.
 *
 * Prompt size moves LLM time-to-first-token more than anything else on this
 * path — measured at 0.36s on a short prompt against 2.2s with full recall — so
 * the tasks are budgeted like every other section rather than sent whole.
 * Forty tasks would otherwise quietly double the pre-first-token cost of every
 * turn for the sake of thirty nobody asked about.
 */
export const MAX_BOARD_CHARS = 1100;

/** Most topics named for a new task to land in, beyond those whose tasks are listed. */
const MAX_TOPICS = 8;

/** Untouched for this many drives before it is worth mentioning unprompted. */
const STALE_AFTER_SESSIONS = 2;

/**
 * The states the agent is shown, in the order it should care about them
 * within a topic.
 *
 * `done` and `dropped` are omitted. They are the largest share of any task list
 * that has been running a while and the least use in a conversation about what
 * to do next — and the person asking "what did I finish" is asking a question
 * `passages` already answers from what they actually said. The topic's sheet
 * shows them struck through; the agent need not read them out.
 */
const LIVE_STATES = ["doing", "next", "open"] as const;

const HEADING = "Their tasks, by topic — each topic's sheet in the Stack lists these under Tasks:";

export interface BoardContext {
  /** Rendered block. Null only when their tasks are not being shown at all. */
  text: string | null;
  /** For the analytics on the route — how many tasks were shown. */
  shown: number;
  total: number;
}

/** Where the conversation is, so the topics it is on come first. */
export interface TaskFocus {
  /** The title of the topic whose sheet is open on their screen, as the screen reports it. */
  openTopic?: string | null;
  /** This drive: the topics it has written to are the ones the conversation is about. */
  captureSessionId?: string | null;
}

/**
 * One line per task: its state, the task, the handle to act on it with, and
 * how long it has sat. The topic is the group's heading, not repeated.
 *
 * Deliberately flat and short. This competes for the same prompt budget as
 * recall, and a task is a sentence.
 */
function renderTask(card: BoardCard): string {
  const notes = [`task ${cardHandle(card.cardId)}`];
  if (card.staleSessions >= STALE_AFTER_SESSIONS) {
    notes.push(`untouched for ${card.staleSessions} drives`);
  }
  return `- [${card.state}] ${card.block.text} (${notes.join(" · ")})`;
}

/**
 * The topics in the order the conversation reaches them: the open sheet, then
 * what this drive has talked about (most recent first), then every other topic
 * in the workspace's own order, most recently touched first.
 */
function orderTopics(
  topics: readonly Topic[],
  ops: readonly StoredOp[],
  focus: TaskFocus,
  findOpen: () => Topic | undefined,
): { ordered: Topic[]; open: Topic | undefined; inConversation: Set<string> } {
  const inConversation = new Set<string>();
  const lastSeqInDrive = new Map<string, number>();
  if (focus.captureSessionId) {
    for (const id of topicsTouchedBy(ops, focus.captureSessionId)) inConversation.add(id);
    for (const { op, seq, captureSessionId } of ops) {
      if (captureSessionId !== focus.captureSessionId || !("topicId" in op)) continue;
      lastSeqInDrive.set(op.topicId, Math.max(seq, lastSeqInDrive.get(op.topicId) ?? 0));
    }
  }
  const open = findOpen();
  const rank = (t: Topic) => (t.id === open?.id ? 0 : inConversation.has(t.id) ? 1 : 2);
  const ordered = topics
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        rank(a.t) - rank(b.t) ||
        (lastSeqInDrive.get(b.t.id) ?? 0) - (lastSeqInDrive.get(a.t.id) ?? 0) ||
        a.i - b.i,
    )
    .map(({ t }) => t);
  return { ordered, open, inConversation };
}

/**
 * Fold the ledger and render their live tasks, grouped by topic.
 *
 * Within a topic, `doing` → `next` → `open`, and within a state by most
 * recently moved, which is `foldBoard`'s own order: the task that just changed
 * is the one a conversation is most likely to be about.
 *
 * Trimmed from the END, unlike recall: the groups are already in order of
 * relevance, so what falls off is the least-related topic, never the one on
 * their screen.
 */
export function buildBoardContext(ops: readonly StoredOp[], focus: TaskFocus = {}): BoardContext {
  const board = foldBoard(ops);
  const state = board.workspace;
  const touched = focus.captureSessionId ? topicsTouchedBy(ops, focus.captureSessionId) : undefined;
  const { ordered, open, inConversation } = orderTopics(state.topics, ops, focus, () =>
    focus.openTopic ? findTopic(state, focus.openTopic, touched) : undefined,
  );

  const byTopic = new Map<string, BoardCard[]>();
  for (const s of LIVE_STATES) {
    for (const card of board.columns[s]) {
      const list = byTopic.get(card.topic.id);
      if (list) list.push(card);
      else byTopic.set(card.topic.id, [card]);
    }
  }

  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  const unlisted: string[] = [];
  for (const topic of ordered) {
    const tasks = byTopic.get(topic.id) ?? [];
    const note =
      topic.id === open?.id
        ? " (its sheet is open on their screen)"
        : inConversation.has(topic.id)
          ? " (talked about in this conversation)"
          : "";
    if (tasks.length === 0) {
      unlisted.push(`${topic.title}${note}`);
      continue;
    }
    const header = `${topic.title}${note}:`;
    const rendered = tasks.map(renderTask);
    // A heading only with at least its first task: a topic named with nothing
    // under it would read as a topic with nothing open.
    if (used + header.length + (rendered[0]?.length ?? 0) > MAX_BOARD_CHARS) {
      unlisted.push(`${topic.title}${note}`);
      continue;
    }
    lines.push(header);
    used += header.length;
    for (const line of rendered) {
      if (used + line.length > MAX_BOARD_CHARS) break;
      lines.push(line);
      used += line.length;
      shown += 1;
    }
  }

  const others = unlisted.slice(0, MAX_TOPICS);
  const topicLine = others.length
    ? `\n${shown ? "Their other topics" : "Their topics"}: ${others.join(" · ")}`
    : "";

  // No open tasks is still an answer: the agent can add one, and "nothing is
  // open" is the reply to "what's left" rather than silence about it.
  return {
    text: shown ? `${HEADING}\n${lines.join("\n")}${topicLine}` : `Their tasks: nothing open.${topicLine}`,
    shown,
    total: board.cards.length,
  };
}
