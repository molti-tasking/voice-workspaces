import { DEFAULT_TOPIC_ICON } from "./icons";
import type {
  Block,
  StoredOp,
  Topic,
  WorkspaceDiff,
  WorkspaceState,
} from "./types";

/**
 * Fold an op log into workspace state.
 *
 *   workspace(T) = fold(ops where occurredAt <= T)
 *
 * Pure and total. Everything the design promises falls out of this one
 * property: time travel, per-drive diffs, and re-derivation after the
 * extraction prompt changes.
 *
 * Ops are applied in `seq` order, never in array order — callers may hand us
 * rows in whatever order the database returned them, and a fold whose result
 * depended on that would not be deterministic.
 *
 * Unknown or dangling references are skipped rather than thrown on. Ops come
 * from a language model, so a block referencing a topic that was never created
 * is a normal failure mode; losing one block is much better than failing to
 * render the workspace at all.
 */
export function foldWorkspace(ops: readonly StoredOp[], asOf?: Date): WorkspaceState {
  const cutoff = asOf?.getTime();

  const relevant = ops
    .filter((o) => cutoff === undefined || o.occurredAt.getTime() <= cutoff)
    .slice()
    .sort((a, b) => a.seq - b.seq);

  const topics = new Map<string, Topic>();
  const allBlocks = new Map<string, Block>();

  for (const stored of relevant) {
    const { op } = stored;

    switch (op.type) {
      case "create_topic": {
        // Idempotent: a replayed or duplicated create must not reset a topic
        // that has since been renamed or touched.
        if (topics.has(op.topicId)) break;
        topics.set(op.topicId, {
          id: op.topicId,
          title: op.title,
          slug: op.slug ?? slugify(op.title),
          icon: op.icon ?? DEFAULT_TOPIC_ICON,
          createdAt: stored.occurredAt,
          lastTouchedAt: stored.occurredAt,
        });
        break;
      }

      case "rename_topic": {
        const topic = topics.get(op.topicId);
        if (!topic) break;
        topic.title = op.title;
        if (op.icon) topic.icon = op.icon;
        topic.lastTouchedAt = stored.occurredAt;
        break;
      }

      case "merge_topics": {
        const from = topics.get(op.fromTopicId);
        const into = topics.get(op.intoTopicId);
        if (!from || !into || from.id === into.id) break;

        // Tombstone rather than delete: blocks still reference the old id, and
        // a later op may too. Resolution follows the chain at read time.
        from.mergedIntoId = into.id;
        into.lastTouchedAt = stored.occurredAt;
        break;
      }

      case "add_block": {
        // A duplicate id would otherwise silently overwrite real content.
        if (allBlocks.has(op.blockId)) break;
        const topicId = resolveTopic(topics, op.topicId);
        if (!topicId) break;

        allBlocks.set(op.blockId, {
          id: op.blockId,
          topicId,
          kind: op.kind,
          text: op.text,
          spans: op.spans ?? [],
          occurredAt: stored.occurredAt,
          extractionId: stored.extractionId,
        });
        touch(topics, topicId, stored.occurredAt);
        break;
      }

      case "revise_block": {
        if (allBlocks.has(op.blockId)) break;
        const previous = allBlocks.get(op.supersedesBlockId);
        // Without the block it claims to replace there is nothing to supersede;
        // treating it as a plain addition keeps the content.
        const topicId = resolveTopic(topics, op.topicId) ?? previous?.topicId;
        if (!topicId) break;

        if (previous) previous.supersededById = op.blockId;

        allBlocks.set(op.blockId, {
          id: op.blockId,
          topicId,
          kind: op.kind,
          text: op.text,
          spans: op.spans ?? [],
          occurredAt: stored.occurredAt,
          supersedes: previous ? op.supersedesBlockId : undefined,
          extractionId: stored.extractionId,
        });
        touch(topics, topicId, stored.occurredAt);
        break;
      }

      case "retire_block": {
        const block = allBlocks.get(op.blockId);
        if (!block || block.retiredAt) break;
        block.retiredAt = stored.occurredAt;
        touch(topics, block.topicId, stored.occurredAt);
        break;
      }

      case "move_block": {
        const block = allBlocks.get(op.blockId);
        const topicId = resolveTopic(topics, op.toTopicId);
        if (!block || !topicId) break;
        block.topicId = topicId;
        touch(topics, topicId, stored.occurredAt);
        break;
      }
    }
  }

  /* Project to the visible view. */
  const blocksByTopic = new Map<string, Block[]>();
  for (const block of allBlocks.values()) {
    if (block.supersededById || block.retiredAt) continue;
    // A block may sit on a topic that was merged away after it was added.
    const topicId = resolveTopic(topics, block.topicId) ?? block.topicId;
    const list = blocksByTopic.get(topicId);
    if (list) list.push(block);
    else blocksByTopic.set(topicId, [block]);
  }

  for (const list of blocksByTopic.values()) {
    // Chronological within a topic, id as a stable tie-break so two blocks
    // extracted from the same moment do not swap places between folds.
    list.sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : 1),
    );
  }

  const liveTopics = [...topics.values()]
    .filter((t) => !t.mergedIntoId)
    .sort(
      (a, b) =>
        b.lastTouchedAt.getTime() - a.lastTouchedAt.getTime() ||
        (a.id < b.id ? -1 : 1),
    );

  return {
    topics: liveTopics,
    blocksByTopic,
    allBlocks,
    asOf: relevant.length > 0 ? relevant[relevant.length - 1]!.occurredAt : null,
    opCount: relevant.length,
  };
}

/**
 * Follow a merge chain to the surviving topic.
 *
 * Bounded so a cycle — which an LLM can absolutely produce by merging A into B
 * and later B into A — cannot hang the fold.
 */
function resolveTopic(topics: Map<string, Topic>, topicId: string): string | undefined {
  let current = topics.get(topicId);
  let hops = 0;
  while (current?.mergedIntoId && hops < 32) {
    current = topics.get(current.mergedIntoId);
    hops += 1;
  }
  return current?.id;
}

function touch(topics: Map<string, Topic>, topicId: string, at: Date): void {
  const topic = topics.get(topicId);
  if (topic && at.getTime() > topic.lastTouchedAt.getTime()) {
    topic.lastTouchedAt = at;
  }
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "topic"
  );
}

/**
 * What changed between two folds of the same log.
 *
 * `diffWorkspace(fold(atStart), fold(atEnd))` is what a drive actually
 * contributed — the per-session view, and the closest thing to a "transaction"
 * in the accounting analogy.
 */
export function diffWorkspace(
  before: WorkspaceState,
  after: WorkspaceState,
): WorkspaceDiff {
  const addedTopics = after.topics.filter(
    (t) => !before.topics.some((b) => b.id === t.id),
  );

  const addedBlocks: Block[] = [];
  const revisedBlocks: { from: Block; to: Block }[] = [];

  for (const block of after.allBlocks.values()) {
    if (before.allBlocks.has(block.id)) continue;
    if (block.supersededById || block.retiredAt) continue;

    const previous = block.supersedes ? before.allBlocks.get(block.supersedes) : undefined;
    if (previous) revisedBlocks.push({ from: previous, to: block });
    else addedBlocks.push(block);
  }

  const retiredBlocks: Block[] = [];
  for (const block of after.allBlocks.values()) {
    if (!block.retiredAt) continue;
    const was = before.allBlocks.get(block.id);
    if (was && !was.retiredAt) retiredBlocks.push(block);
  }

  const byTime = (a: { occurredAt: Date }, b: { occurredAt: Date }) =>
    a.occurredAt.getTime() - b.occurredAt.getTime();

  addedBlocks.sort(byTime);
  retiredBlocks.sort(byTime);
  revisedBlocks.sort((a, b) => byTime(a.to, b.to));

  return { addedTopics, addedBlocks, revisedBlocks, retiredBlocks };
}
