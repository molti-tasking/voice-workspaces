import { z } from "zod";
import { ConversationDisplay } from "./contracts";

/**
 * The display study's session: one sitting, one short conversation about an
 * everyday problem, shown one of three ways on the phone — between
 * participants, so each sees one view and never compares it with another.
 * After it, a summary and a few questions.
 *
 * What crosses the wire between the session page (`/study/session`) and its
 * routes, and the session's shape. Pure: shared by the pages, the routes and
 * the database, and safe in the browser.
 */

/** Bump when the questions change enough that answers should not be pooled. */
export const SESSION_VERSION = "session-2";

/**
 * How the session compares the views. "within" was session-1's: four
 * conversations, every view for every participant. Stored on each session, so
 * no analysis pools the two.
 */
export const SESSION_DESIGN = "between";

/**
 * The tasks a session can have, by id. The words — what they read and what the
 * agent is told — are `SESSION_TASKS` in @voicemural/talkback/study-task.
 * Sessions use `SESSION_TASK_PAIR` of them.
 */
export const SESSION_TASK_IDS = ["trip", "birthday", "move", "dinners"] as const;
export type SessionTaskId = (typeof SESSION_TASK_IDS)[number];

export function isSessionTaskId(value: unknown): value is SessionTaskId {
  return typeof value === "string" && (SESSION_TASK_IDS as readonly string[]).includes(value);
}

/**
 * The views the session compares: the plain transcript, the baseline — the
 * way a voice assistant's chat shows a voice conversation — and the mirror's
 * two layouts. The column view (`conversation`) is the field app's, and not
 * one of them.
 */
export const SESSION_DISPLAYS = ["transcript", "track", "bubbles"] as const satisfies readonly ConversationDisplay[];
export type SessionDisplay = (typeof SESSION_DISPLAYS)[number];

export function isSessionDisplay(value: unknown): value is SessionDisplay {
  return typeof value === "string" && (SESSION_DISPLAYS as readonly string[]).includes(value);
}

/**
 * The two tasks sessions rotate. Two rather than one, so a finding is not
 * about a single scenario; two rather than four, so each view meets each task
 * often enough to tell the task from the view.
 */
export const SESSION_TASK_PAIR = ["trip", "birthday"] as const satisfies readonly SessionTaskId[];

/**
 * How many different sessions there are: every view with every task. A
 * session's cell (`order_index`) is taken modulo this.
 */
export const SESSION_CELLS = SESSION_DISPLAYS.length * SESSION_TASK_PAIR.length;

/** Conversations in one session. */
export const SESSION_BLOCKS = 1;

/**
 * The view and task of the session in cell `k`. The view turns with every
 * session and the task with every other, so any three sessions in a row
 * cover the three views, any two cover both tasks, and the six cells hold
 * every pair once — which holds only while the two counts share no factor.
 */
export function cellFor(k: number): { display: SessionDisplay; task: SessionTaskId } {
  const cell = ((Math.trunc(k) % SESSION_CELLS) + SESSION_CELLS) % SESSION_CELLS;
  return {
    display: SESSION_DISPLAYS[cell % SESSION_DISPLAYS.length]!,
    task: SESSION_TASK_PAIR[cell % SESSION_TASK_PAIR.length]!,
  };
}

export interface SessionBlockPlan {
  /** In the order they are done; 0, while a session is one conversation. */
  position: number;
  display: SessionDisplay;
  task: SessionTaskId;
}

/** The blocks of the session in cell `k`: its one conversation. */
export function blocksFor(k: number): SessionBlockPlan[] {
  return [{ position: 0, ...cellFor(k) }];
}

/**
 * When things happen in a conversation, in ms of recording (the drive's
 * clock, which runs on through the game).
 */
export interface SessionTimings {
  /** Finish is offered from here, once the game is done. */
  talkMinMs: number;
  /** The page suggests wrapping up from here. */
  talkTargetMs: number;
  /** The conversation ends here by itself. */
  talkCapMs: number;
  /** The game interrupts at the first quiet moment from here… */
  gameEarliestMs: number;
  /** …and here at the latest, quiet or not. */
  gameLatestMs: number;
  /** Rounds go on until the game has lasted this long… */
  gameMinMs: number;
  /** …and the round under way is cut off here. */
  gameCapMs: number;
  /** The first "how easy is it to follow?", before the game. */
  esmFollowMs: number;
  /** The second, this long after they are back from the game. */
  esmAfterResumeMs: number;
  /** "How much effort does it take?", late in the conversation. */
  esmEffortMs: number;
  /** No two of those closer together than this. */
  esmSpacingMs: number;
}

export const SESSION_TIMINGS: SessionTimings = {
  talkMinMs: 4 * 60_000,
  talkTargetMs: 5 * 60_000,
  talkCapMs: 7 * 60_000,
  gameEarliestMs: 135_000,
  gameLatestMs: 180_000,
  gameMinMs: 60_000,
  gameCapMs: 75_000,
  esmFollowMs: 105_000,
  esmAfterResumeMs: 60_000,
  esmEffortMs: 270_000,
  esmSpacingMs: 20_000,
};

/**
 * The timings sped up `fast` times, for walking through a session without
 * sitting through it (`?fast=10`). Never in front of a participant.
 */
export function scaledTimings(fast: number): SessionTimings {
  const by = Number.isFinite(fast) ? Math.min(60, Math.max(1, fast)) : 1;
  return Object.fromEntries(
    Object.entries(SESSION_TIMINGS).map(([key, ms]) => [key, Math.round(ms / by)]),
  ) as unknown as SessionTimings;
}

/**
 * How long both sides must have been quiet for the game to take its moment:
 * a pause between turns, not the middle of a sentence. Not sped up — it is
 * about speech, not about the session's length.
 */
export const GAME_QUIET_MS = 1_500;

/** Whether the game should interrupt now: a quiet moment once it may, or the deadline. */
export function gameDue(input: { elapsedMs: number; quietMs: number; timings: SessionTimings }): boolean {
  const { elapsedMs, quietMs, timings } = input;
  if (elapsedMs >= timings.gameLatestMs) return true;
  return elapsedMs >= timings.gameEarliestMs && quietMs >= GAME_QUIET_MS;
}

/* ---------------------------------------------------------------------------
 * Experience sampling: one tap, during the conversation
 * ------------------------------------------------------------------------- */

/** The questions asked during a conversation, 1 to 7 with one tap. */
export const ESM_ITEMS = {
  esm_follow: {
    question: "Right now, how easy is it to follow the conversation?",
    low: "Very hard",
    high: "Very easy",
  },
  esm_effort: {
    question: "Right now, how much effort does keeping up take?",
    low: "Very little",
    high: "A great deal",
  },
} as const;
export type EsmItem = keyof typeof ESM_ITEMS;

/** A prompt not answered within this is put away, and stored as unanswered. Not sped up. */
export const ESM_EXPIRY_MS = 10_000;
/** It waits for both sides to have been quiet this long, so it never lands mid-sentence. */
export const ESM_QUIET_MS = 1_000;

export interface EsmSlot {
  /** Its place in the conversation: the moment's ordinal. */
  ordinal: number;
  item: EsmItem;
  /** When it is due, on the drive's clock; null until it can be known (after the game). */
  dueMs: number | null;
}

/**
 * The three prompts of a conversation: how easy it is to follow, before the
 * game and again a minute after it — the contrast the interruption is for —
 * and the effort it takes, late on.
 *
 * Both later ones wait for them to be back. The effort prompt also comes
 * after the second follow one: due at a fixed time, it could land the moment
 * they returned, on top of the resumption being measured.
 */
export function esmSlots(timings: SessionTimings, resumedAtMs: number | null): EsmSlot[] {
  const followAgain = resumedAtMs === null ? null : resumedAtMs + timings.esmAfterResumeMs;
  return [
    { ordinal: 0, item: "esm_follow", dueMs: timings.esmFollowMs },
    { ordinal: 1, item: "esm_follow", dueMs: followAgain },
    {
      ordinal: 2,
      item: "esm_effort",
      dueMs: followAgain === null ? null : Math.max(timings.esmEffortMs, followAgain + timings.esmSpacingMs),
    },
  ];
}

/**
 * The prompt to show now, if any: the earliest one due and not yet shown,
 * in a quiet moment, never while something else is on the screen (`busy`:
 * the game, the question after it), and not too soon after the last one.
 */
export function esmDue(input: {
  elapsedMs: number;
  quietMs: number;
  busy: boolean;
  shown: ReadonlySet<number>;
  lastShownMs: number | null;
  resumedAtMs: number | null;
  timings: SessionTimings;
}): EsmSlot | null {
  const { elapsedMs, quietMs, busy, shown, lastShownMs, resumedAtMs, timings } = input;
  if (busy || quietMs < ESM_QUIET_MS) return null;
  if (lastShownMs !== null && elapsedMs - lastShownMs < timings.esmSpacingMs) return null;
  const due = esmSlots(timings, resumedAtMs)
    .filter((s) => !shown.has(s.ordinal) && s.dueMs !== null && s.dueMs <= elapsedMs)
    .sort((a, b) => a.dueMs! - b.dueMs!);
  return due[0] ?? null;
}

/* ---------------------------------------------------------------------------
 * Moments: what happened when, on the drive's clock
 * ------------------------------------------------------------------------- */

/**
 * What a moment is:
 * - `esm`: a one-tap prompt (`item` is its question; `value` 1-7, or null
 *   when it expired).
 * - `game`: the interruption, from the pause to the end of its last round.
 * - `probe`: "where were you?", typed straight after the game.
 * - `resume`: back in the conversation; answered at their first words.
 */
export const MOMENT_KINDS = ["esm", "game", "probe", "resume"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

const Offset = z.number().int().min(0).max(4 * 3_600_000);

/** One moment, as the page sends it. The first one sent for a kind and ordinal stands. */
export const SessionMoment = z.strictObject({
  kind: z.enum(MOMENT_KINDS),
  ordinal: z.number().int().min(0).max(9),
  item: z.string().regex(/^[a-z_]{1,32}$/),
  shownOffsetMs: Offset,
  /** Null: never answered — an expired prompt, or no words before Finish. */
  answeredOffsetMs: Offset.nullable(),
  value: z.number().int().min(0).max(1000).nullable(),
  text: z.string().trim().max(2000).nullable(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export type SessionMoment = z.infer<typeof SessionMoment>;

/** What they type after the game, before they see the conversation again. */
export const PROBE_QUESTION = "Just before the game, what were you talking about, and where had you got to?";

/** The secret in an invite link. Long enough not to be guessed. */
export const SessionCode = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Consent given on the first page: claim the invite for this browser's account. */
export const SessionEnroll = z.object({
  code: SessionCode,
  consent: z.literal(true),
});
export type SessionEnroll = z.infer<typeof SessionEnroll>;

const Likert = z.number().int().min(1).max(7);
const Position = z.number().int().min(0).max(SESSION_BLOCKS - 1);

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
  /** Something that happened during the conversation (`SessionMoment`). */
  z.object({ step: z.literal("moment"), position: Position, moment: SessionMoment }),
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
