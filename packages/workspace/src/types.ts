import { TASK_STATES } from "@voicemural/shared";
import { z } from "zod";

/**
 * The workspace: a balance sheet derived from the transcript ledger.
 *
 * A transcript answers "what did I say, when". It cannot answer "what do I
 * currently think about X", because speaking is linear and jumps between topics
 * while understanding is neither. The workspace is the compact, topic-sorted
 * view of everything said up to a point in time, and each newly transcribed
 * stretch of speech produces a *diff* against it — exactly as an accounting
 * transaction is a diff between two balance sheets.
 */

/* ---------------------------------------------------------------------------
 * Input
 * ------------------------------------------------------------------------- */

/**
 * A stretch of transcribed speech.
 *
 * Deliberately NOT the `utterance` row from @voicemural/db. This package must
 * fold any transcript, not only ours — that portability is the whole point of
 * keeping it free of database imports.
 */
export interface TranscriptSegment {
  id: string;
  /**
   * Absolute wall-clock time, not an offset within a session.
   *
   * The workspace is cumulative across every drive, so all sessions compose
   * onto one timeline and "as of last Tuesday" is a meaningful question.
   */
  occurredAt: Date;
  text: string;
  /** Optional Midas-touch classification of the raw stream (see note below). */
  kind?: "content" | "directive" | "unclassified";
}

/* ---------------------------------------------------------------------------
 * Blocks
 * ------------------------------------------------------------------------- */

/**
 * How a block reads in the workspace.
 *
 * NOT the same axis as `TranscriptSegment.kind`. That one asks "was this speech
 * addressed to the system?" — the Midas-touch problem, a property of the raw
 * stream. This one asks "what role does this play in the derived document?".
 * Conflating them would collapse two genuinely different questions.
 */
export const BlockKind = z.enum(["claim", "context", "meta", "question", "fact", "task"]);
export type BlockKind = z.infer<typeof BlockKind>;

/**
 * Where a `task` stands — the tense of the speech that last mentioned it.
 *
 * Carried on the op payload rather than as its own op type, for the same
 * reason topic icons are: a transition is a `revise_block` with a new state,
 * and adding one needed no enum migration on a deployed database. The literal
 * set lives in `@voicemural/shared` so the analytics taxonomy can type it.
 */
export const TaskState = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskState>;

/**
 * Who posted an op, when it was not the extractor.
 *
 * Extraction ops omit this. A manual gesture on the board — moving a card,
 * retiring one — carries `"user"`, so the fold can tell a person's correction
 * from the model's reading of their speech. That distinction is the
 * measurement: whether a speech-driven transition was kept or reversed.
 */
export type OpVia = "user";

/** A span of derived text traced back to the utterance it came from. */
export const BlockSpan = z.object({
  utteranceId: z.string(),
  startChar: z.number().int().min(0).optional(),
  endChar: z.number().int().min(0).optional(),
});
export type BlockSpan = z.infer<typeof BlockSpan>;

export interface Block {
  id: string;
  topicId: string;
  kind: BlockKind;
  /**
   * The left-hand column for a `fact` — "Duration", "Funding", "Based in".
   *
   * Facts are attributes, not prose, and a sentence is a poor container for
   * one. Splitting the label off lets a run of them render as a table on the
   * card and as a real Markdown table on export, which is far denser than the
   * same content written out as bullets.
   */
  label?: string;
  text: string;
  /** Only on a `task`; absent on every other kind. Defaults to `open`. */
  state?: TaskState;
  /** Set on a block a person posted from the board, not the extractor. */
  via?: OpVia;
  spans: BlockSpan[];
  /** When the speech behind this block was said. */
  occurredAt: Date;
  /** Set when a later block supersedes this one. */
  supersededById?: string;
  /** The block this one replaced, if any — the revision chain. */
  supersedes?: string;
  retiredAt?: Date;
  /** Which model call produced it. Null for ops not sourced from an extraction. */
  extractionId?: string;
}

export interface Topic {
  id: string;
  title: string;
  slug: string;
  /** lucide component name, always valid — normalised when the op is parsed. */
  icon: string;
  createdAt: Date;
  lastTouchedAt: Date;
  /** Set when merged away; the topic is kept as a tombstone so ids stay valid. */
  mergedIntoId?: string;
}

/* ---------------------------------------------------------------------------
 * Ops — the ledger postings
 * ------------------------------------------------------------------------- */

export const WorkspaceOp = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_topic"),
    topicId: z.string().min(1),
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    /**
     * A lucide component name from the allowlist in extract.ts.
     *
     * Carried on the payload (jsonb) rather than as its own op type, so adding
     * icons needed no enum migration on a deployed database.
     */
    icon: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("rename_topic"),
    topicId: z.string().min(1),
    title: z.string().min(1),
    icon: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("merge_topics"),
    fromTopicId: z.string().min(1),
    intoTopicId: z.string().min(1),
  }),
  z.object({
    type: z.literal("add_block"),
    blockId: z.string().min(1),
    topicId: z.string().min(1),
    kind: BlockKind,
    /** Only meaningful for `fact`; ignored elsewhere. */
    label: z.string().min(1).optional(),
    text: z.string().min(1),
    /** Only meaningful for `task`; ignored elsewhere. */
    state: TaskState.optional(),
    via: z.enum(["user"]).optional(),
    spans: z.array(BlockSpan).default([]),
  }),
  z.object({
    type: z.literal("revise_block"),
    blockId: z.string().min(1),
    supersedesBlockId: z.string().min(1),
    topicId: z.string().min(1),
    kind: BlockKind,
    label: z.string().min(1).optional(),
    text: z.string().min(1),
    /**
     * On a `task`, the new state. Omitted, the revision inherits the previous
     * block's state — a sharper wording is not a transition.
     */
    state: TaskState.optional(),
    via: z.enum(["user"]).optional(),
    spans: z.array(BlockSpan).default([]),
  }),
  z.object({
    type: z.literal("retire_block"),
    blockId: z.string().min(1),
    via: z.enum(["user"]).optional(),
  }),
  z.object({
    type: z.literal("move_block"),
    blockId: z.string().min(1),
    toTopicId: z.string().min(1),
  }),
]);
export type WorkspaceOp = z.infer<typeof WorkspaceOp>;

export type WorkspaceOpType = WorkspaceOp["type"];

/** An op as persisted: the payload plus its position on the timeline. */
export interface StoredOp {
  id: string;
  /** Total order. Breaks ties when two ops share an `occurredAt`. */
  seq: number;
  occurredAt: Date;
  op: WorkspaceOp;
  extractionId?: string;
  captureSessionId?: string;
  sourceUtteranceIds?: string[];
}

/* ---------------------------------------------------------------------------
 * Folded state
 * ------------------------------------------------------------------------- */

export interface WorkspaceState {
  /** Live topics, most recently touched first. Merged-away topics are excluded. */
  topics: Topic[];
  /** Visible blocks by topic id: not superseded, not retired. */
  blocksByTopic: Map<string, Block[]>;
  /** Every block ever, including superseded and retired ones, by id. */
  allBlocks: Map<string, Block>;
  /** Timestamp of the last op folded in, or null for an empty workspace. */
  asOf: Date | null;
  opCount: number;
}

export interface WorkspaceDiff {
  addedTopics: Topic[];
  addedBlocks: Block[];
  revisedBlocks: { from: Block; to: Block }[];
  retiredBlocks: Block[];
}
