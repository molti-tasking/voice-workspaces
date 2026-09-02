/**
 * How topics moved over time.
 *
 * The workspace answers "what do I currently think about X". It cannot answer
 * "how did I get here" — folding to a single moment is exactly what discards
 * that. This folds to every moment and keeps the shape.
 *
 * The whole thing is `foldWorkspace` and `diffWorkspace` in a loop. No new
 * state, no materialised table, no second source of truth: a trajectory that
 * could disagree with the workspace would be worse than no trajectory, and the
 * only way to guarantee it cannot is to compute it from the same fold.
 *
 * Pure: no I/O, no model call, no database.
 */
import { diffWorkspace, foldWorkspace } from "./fold";
import type { Block, StoredOp, WorkspaceState } from "./types";

export type Bucket = "day" | "session";

export interface TrajectoryPoint {
  /** Live blocks under this topic at the end of the bucket. */
  size: number;
  /** Blocks added during it. */
  added: number;
  /** Blocks that superseded an earlier one — the thinking changing its mind. */
  revised: number;
  retired: number;
}

export interface TopicTrack {
  topicId: string;
  title: string;
  icon: string;
  firstSeen: Date;
  lastTouched: Date;
  /** One per bucket, same length and order as `buckets`. */
  points: TrajectoryPoint[];
  /** Live blocks at the final bucket. Zero for a topic that faded out. */
  current: number;
  /** Total blocks ever added or revised under it — how much it was worked on. */
  weight: number;
}

export interface Revision {
  at: Date;
  topicId: string;
  from: Block;
  to: Block;
}

export interface Trajectory {
  /** End of each bucket, oldest first. Empty for an empty op log. */
  buckets: Date[];
  /** Ordered by first appearance, so a stacked chart never crosses its own bands. */
  tracks: TopicTrack[];
  revisions: Revision[];
  /** The state at the last bucket — what the workspace shows for the same `asOf`. */
  final: WorkspaceState;
}

/**
 * Bucket boundaries, derived from the ops rather than from the calendar.
 *
 * Event-dense on purpose. A participant who records four times a week and then
 * goes on holiday should see a gap between two clusters, not three weeks of
 * flat line that dominates the chart and compresses everything interesting into
 * the left-hand tenth of it.
 */
function boundaries(ops: readonly StoredOp[], bucket: Bucket): Date[] {
  if (ops.length === 0) return [];

  const keyed = new Map<string, Date>();

  for (const op of ops) {
    const key =
      bucket === "session"
        ? (op.captureSessionId ?? op.occurredAt.toISOString().slice(0, 10))
        : op.occurredAt.toISOString().slice(0, 10);

    const existing = keyed.get(key);
    if (!existing || op.occurredAt > existing) keyed.set(key, op.occurredAt);
  }

  return [...keyed.values()].sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Build the trajectory.
 *
 * Cost is O(buckets × ops): one `foldWorkspace` per boundary, each a linear
 * pass. At five weeks of daily commutes that is roughly thirty folds over a few
 * thousand ops, which is milliseconds — and it comes off a single `loadOps`
 * query. Say no to a materialised table until those numbers are wrong.
 */
export function buildTrajectory(
  ops: readonly StoredOp[],
  opts: { bucket?: Bucket; asOf?: Date } = {},
): Trajectory {
  const bucket = opts.bucket ?? "session";
  const cutoff = opts.asOf?.getTime();

  const visible = cutoff === undefined
    ? ops
    : ops.filter((o) => o.occurredAt.getTime() <= cutoff);

  const buckets = boundaries(visible, bucket);

  if (buckets.length === 0) {
    return { buckets: [], tracks: [], revisions: [], final: foldWorkspace([]) };
  }

  const states = buckets.map((at) => foldWorkspace(visible, at));
  const final = states[states.length - 1]!;

  const revisions: Revision[] = [];
  const tracks = new Map<string, TopicTrack>();

  let previous = foldWorkspace([]);

  buckets.forEach((at, index) => {
    const state = states[index]!;
    const diff = diffWorkspace(previous, state);

    // Every topic ever seen up to here keeps a point, including one that has
    // gone quiet: a band that drops to zero and stays there is the visible
    // shape of a thought being finished with, and dropping the row would make
    // that look like the topic never existed.
    for (const topic of state.topics) {
      let track = tracks.get(topic.id);
      if (!track) {
        track = {
          topicId: topic.id,
          title: topic.title,
          icon: topic.icon,
          firstSeen: topic.createdAt,
          lastTouched: topic.lastTouchedAt,
          // Back-fill the buckets before this topic existed, so every track is
          // the same length and a chart can index them positionally.
          points: Array.from({ length: index }, () => emptyPoint()),
          current: 0,
          weight: 0,
        };
        tracks.set(topic.id, track);
      }
      track.title = topic.title;
      track.icon = topic.icon;
      track.lastTouched = topic.lastTouchedAt;
    }

    const addedByTopic = countBy(diff.addedBlocks, (b) => b.topicId);
    const revisedByTopic = countBy(diff.revisedBlocks.map((r) => r.to), (b) => b.topicId);
    const retiredByTopic = countBy(diff.retiredBlocks, (b) => b.topicId);

    for (const track of tracks.values()) {
      const added = addedByTopic.get(track.topicId) ?? 0;
      const revised = revisedByTopic.get(track.topicId) ?? 0;
      const retired = retiredByTopic.get(track.topicId) ?? 0;
      const size = state.blocksByTopic.get(track.topicId)?.length ?? 0;

      track.points.push({ size, added, revised, retired });
      track.current = size;
      track.weight += added + revised;
    }

    for (const { from, to } of diff.revisedBlocks) {
      revisions.push({ at, topicId: to.topicId, from, to });
    }

    previous = state;
  });

  return {
    buckets,
    // First appearance, not activity: a stacked chart re-sorted by weight would
    // have its bands swap places between renders, which makes a shape that is
    // supposed to show change over time change for reasons that are not time.
    tracks: [...tracks.values()].sort(
      (a, b) => a.firstSeen.getTime() - b.firstSeen.getTime(),
    ),
    revisions,
    final,
  };
}

function emptyPoint(): TrajectoryPoint {
  return { size: 0, added: 0, revised: 0, retired: 0 };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Stack the tracks into cumulative bands, ready for `<path d=…>`.
 *
 * Returned as `[lower, upper]` per bucket so a band is a closed polygon: the
 * top edge forward, the bottom edge back. Kept here rather than in the
 * component because it is arithmetic, and arithmetic is testable.
 */
export function stackBands(tracks: readonly TopicTrack[]): number[][][] {
  const bucketCount = tracks[0]?.points.length ?? 0;
  const running = Array.from({ length: bucketCount }, () => 0);

  return tracks.map((track) =>
    track.points.map((point, i) => {
      const lower = running[i] ?? 0;
      const upper = lower + point.size;
      running[i] = upper;
      return [lower, upper];
    }),
  );
}

/** The tallest stack, for the y scale. Never zero, so callers can divide. */
export function stackHeight(tracks: readonly TopicTrack[]): number {
  const bucketCount = tracks[0]?.points.length ?? 0;
  let tallest = 0;
  for (let i = 0; i < bucketCount; i += 1) {
    let total = 0;
    for (const track of tracks) total += track.points[i]?.size ?? 0;
    if (total > tallest) tallest = total;
  }
  return Math.max(tallest, 1);
}
