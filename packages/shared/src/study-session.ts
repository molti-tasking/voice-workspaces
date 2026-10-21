import { z } from "zod";
import { ConversationDisplay } from "./contracts";

/**
 * The display study's session: one sitting of four short conversations, each
 * about a different everyday problem and each shown a different way on the
 * phone (`ConversationDisplay`), in an order balanced across participants.
 * After each, a summary and a few ratings; at the end, the four views ranked.
 *
 * What crosses the wire between the session page (`/study/session`) and its
 * routes, and the session's shape. Pure: shared by the pages, the routes and
 * the database, and safe in the browser.
 */

/** Bump when the questions change enough that answers should not be pooled. */
export const SESSION_VERSION = "session-1";

/**
 * The session's four tasks, by id. The words — what they read and what the
 * agent is told — are `SESSION_TASKS` in @voicemural/talkback/study-task.
 */
export const SESSION_TASK_IDS = ["trip", "birthday", "move", "dinners"] as const;
export type SessionTaskId = (typeof SESSION_TASK_IDS)[number];

export function isSessionTaskId(value: unknown): value is SessionTaskId {
  return typeof value === "string" && (SESSION_TASK_IDS as readonly string[]).includes(value);
}

/**
 * The displays in the order the squares below index them: the control first.
 * The same four as `CONVERSATION_DISPLAYS`, named here so the squares cannot
 * change meaning if that list is ever reordered.
 */
const DISPLAYS = ["transcript", "conversation", "track", "bubbles"] as const satisfies readonly ConversationDisplay[];

/*
 * A Graeco-Latin square: row k is participant order k, column i is block i.
 * Across the four orders every display comes once in every position, every
 * task does too, and every display meets every task exactly once — so
 * neither the position nor the task can pass for an effect of the view.
 *
 * Not a Williams square: none of order 4 has an orthogonal mate, and with a
 * handful of formative participants balancing the tasks matters more than
 * balancing which view follows which. The Prolific design decides again.
 */
const DISPLAY_SQUARE = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [2, 3, 0, 1],
  [3, 2, 1, 0],
] as const;
const TASK_SQUARE = [
  [0, 1, 2, 3],
  [2, 3, 0, 1],
  [3, 2, 1, 0],
  [1, 0, 3, 2],
] as const;

/** How many different orders there are; a session's order index is taken modulo this. */
export const SESSION_ORDERS = DISPLAY_SQUARE.length;

export interface SessionBlockPlan {
  /** 0 to 3, in the order they are done. */
  position: number;
  display: ConversationDisplay;
  task: SessionTaskId;
}

/** The four blocks of the session with this order index. */
export function blocksFor(orderIndex: number): SessionBlockPlan[] {
  const row = ((Math.trunc(orderIndex) % SESSION_ORDERS) + SESSION_ORDERS) % SESSION_ORDERS;
  return DISPLAY_SQUARE[row]!.map((d, position) => ({
    position,
    display: DISPLAYS[d]!,
    task: SESSION_TASK_IDS[TASK_SQUARE[row]![position]!]!,
  }));
}

/** How long each conversation runs, in ms of recording. */
export interface SessionTimings {
  /** Finish is offered from here. */
  talkMinMs: number;
  /** The page suggests wrapping up from here. */
  talkTargetMs: number;
  /** The conversation ends here by itself. */
  talkCapMs: number;
}

export const SESSION_TIMINGS: SessionTimings = {
  talkMinMs: 4 * 60_000,
  talkTargetMs: 5 * 60_000,
  talkCapMs: 7 * 60_000,
};

/**
 * The timings sped up `fast` times, for walking through a session without
 * sitting through it (`?fast=10`). Never in front of a participant.
 */
export function scaledTimings(fast: number): SessionTimings {
  const by = Number.isFinite(fast) ? Math.min(60, Math.max(1, fast)) : 1;
  return {
    talkMinMs: Math.round(SESSION_TIMINGS.talkMinMs / by),
    talkTargetMs: Math.round(SESSION_TIMINGS.talkTargetMs / by),
    talkCapMs: Math.round(SESSION_TIMINGS.talkCapMs / by),
  };
}

/** The secret in an invite link. Long enough not to be guessed. */
export const SessionCode = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Consent given on the first page: claim the invite for this browser's account. */
export const SessionEnroll = z.object({
  code: SessionCode,
  consent: z.literal(true),
});
export type SessionEnroll = z.infer<typeof SessionEnroll>;

const Likert = z.number().int().min(1).max(7);
const Position = z.number().int().min(0).max(3);

/** The summary they write after each conversation, before any rating. */
export const SUMMARY_MIN_CHARS = 20;
export const SUMMARY_MAX_CHARS = 2000;
const OPEN_MAX_CHARS = 4000;

/** The ratings after each conversation, 1 to 7, in the order they are asked. */
export const BLOCK_RATINGS = [
  {
    key: "follow",
    question: "How easy was it to follow the conversation?",
    low: "Very hard",
    high: "Very easy",
  },
  {
    key: "effort",
    question: "How much effort did keeping up with it take?",
    low: "Very little",
    high: "A great deal",
  },
  {
    key: "pickup",
    question: "After the game, how easy was it to pick up where you had left off?",
    low: "Very hard",
    high: "Very easy",
    /** Asked only of a conversation the game interrupted. */
    afterGame: true,
  },
  {
    key: "glance",
    question: "How much did you look at the screen while you were talking?",
    low: "Hardly at all",
    high: "Most of the time",
  },
] as const;
export type BlockRatingKey = (typeof BLOCK_RATINGS)[number]["key"];

/** What they answer after one conversation. The first answer stands. */
export const BlockAnswers = z.strictObject({
  summary: z.string().trim().min(SUMMARY_MIN_CHARS).max(SUMMARY_MAX_CHARS),
  follow: Likert,
  effort: Likert,
  /** Absent for a conversation the game did not interrupt. */
  pickup: Likert.optional(),
  glance: Likert,
  /** What helped, or got in the way. Optional. */
  helped: z.string().trim().max(OPEN_MAX_CHARS).optional(),
});
export type BlockAnswers = z.infer<typeof BlockAnswers>;

/** The end of the session: the four views ranked best first, and why. */
export const SessionFinal = z.strictObject({
  ranking: z
    .array(ConversationDisplay)
    .length(4)
    .refine((r) => new Set(r).size === 4, "each view once"),
  why: z.string().trim().max(OPEN_MAX_CHARS).optional(),
  more: z.string().trim().max(OPEN_MAX_CHARS).optional(),
  /** Whether the researchers may get back to them about their answers. */
  contact: z.boolean(),
});
export type SessionFinal = z.infer<typeof SessionFinal>;

/** Everything the session page tells the server after enrolment. */
export const SessionStep = z.discriminatedUnion("step", [
  /** About to start this block's conversation: the next drive is it. */
  z.object({ step: z.literal("arm"), position: Position }),
  /** Whether the drive that just started is this block's (the arm reached it). */
  z.object({ step: z.literal("linked"), position: Position, captureSessionId: z.uuid() }),
  /** They finished the conversation. */
  z.object({ step: z.literal("finished"), position: Position }),
  z.object({ step: z.literal("answers"), position: Position, answers: BlockAnswers }),
  z.object({ step: z.literal("final"), final: SessionFinal }),
]);
export type SessionStep = z.infer<typeof SessionStep>;

/** Where a session stands, as the page needs it to pick up after a reload. */
export interface SessionProgress {
  consented: boolean;
  completed: boolean;
  blocks: readonly { position: number; finished: boolean; answered: boolean }[];
}

export type SessionResume =
  | { at: "consent" }
  /** The block to do next: from its brief, or — talked, not yet answered — its questions. */
  | { at: "brief" | "answers"; position: number }
  | { at: "final" }
  | { at: "done" };

/**
 * The step to open on. A conversation interrupted by a reload starts over
 * from its brief: the drive that was running is kept, but the block is the
 * next one it arms.
 */
export function resumeAt(progress: SessionProgress): SessionResume {
  if (!progress.consented) return { at: "consent" };
  if (progress.completed) return { at: "done" };
  const next = [...progress.blocks].sort((a, b) => a.position - b.position).find((b) => !b.answered);
  if (!next) return { at: "final" };
  return { at: next.finished ? "answers" : "brief", position: next.position };
}
