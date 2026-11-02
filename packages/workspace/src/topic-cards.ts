import { matchTopic } from "./fold";
import type { Block, BlockKind, StoredOp, Topic, WorkspaceState } from "./types";

/**
 * The workspace cards behind one topic of a conversation, for the zoom sheet
 * on the conversation screen (2 Nov 2026).
 *
 * WHY. The workspace and the board were their own screens, folded from the op
 * log across every drive; the conversation screen knew only the topics of the
 * drive on it. Consolidating onto the conversation screen means a topic there
 * has to open onto what the workspace holds on it — its tasks, claims,
 * questions and facts from every drive — without a second screen.
 *
 * HOW A CONVERSATION TOPIC FINDS ITS WORKSPACE TOPIC. They are named by two
 * different models (the container's `TopicTitle` and the extractor), so by
 * name, with `matchTopic`'s rules: the same slug, else exactly one that
 * contains the other. First among the topics this drive actually wrote to,
 * where a loose match is far more likely to be right, then among all of them.
 * No match is an answer: the sheet then shows no cards, which is better than
 * someone else's.
 *
 * Pure, so the route only loads and folds.
 */

export interface TopicCard {
  id: string;
  kind: BlockKind;
  label?: string;
  text: string;
  /** Only on a task. */
  state?: Block["state"];
  occurredAt: string;
}

export interface TopicCards {
  topic: { id: string; title: string; icon: string } | null;
  cards: TopicCard[];
}

/** The order the sheet shows kinds in: what is to be done, then what is thought, then the rest. */
const KIND_ORDER: readonly BlockKind[] = ["task", "claim", "question", "fact", "context"];
/** At most this many cards, newest first within a kind: a sheet, not the workspace. */
export const MAX_TOPIC_CARDS = 24;

/** The topics a drive wrote blocks onto, from the ops it posted. */
export function topicsTouchedBy(ops: readonly StoredOp[], captureSessionId: string): Set<string> {
  const touched = new Set<string>();
  for (const { op, captureSessionId: from } of ops) {
    if (from !== captureSessionId) continue;
    if (op.type === "add_block" || op.type === "revise_block" || op.type === "create_topic") touched.add(op.topicId);
  }
  return touched;
}

export function findTopic(
  state: WorkspaceState,
  title: string,
  touched: ReadonlySet<string> = new Set(),
): Topic | undefined {
  const local = state.topics.filter((t) => touched.has(t.id));
  return (local.length > 0 ? matchTopic(local, title) : undefined) ?? matchTopic(state.topics, title);
}

export function topicCards(
  state: WorkspaceState,
  ops: readonly StoredOp[],
  title: string,
  captureSessionId: string | null,
): TopicCards {
  const topic = findTopic(state, title, captureSessionId ? topicsTouchedBy(ops, captureSessionId) : undefined);
  if (!topic) return { topic: null, cards: [] };
  const blocks = (state.blocksByTopic.get(topic.id) ?? []).filter((b) => KIND_ORDER.includes(b.kind));
  const rank = (b: Block) => KIND_ORDER.indexOf(b.kind);
  // Within a kind, an open task before a finished one, then newest first.
  const doneLast = (b: Block) => (b.kind === "task" && (b.state === "done" || b.state === "dropped") ? 1 : 0);
  const cards = [...blocks]
    .sort((a, b) => rank(a) - rank(b) || doneLast(a) - doneLast(b) || b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, MAX_TOPIC_CARDS)
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      ...(b.label ? { label: b.label } : {}),
      text: b.text,
      ...(b.kind === "task" ? { state: b.state ?? "open" } : {}),
      occurredAt: b.occurredAt.toISOString(),
    }));
  return { topic: { id: topic.id, title: topic.title, icon: topic.icon }, cards };
}
