import { z } from "zod";
import { CONVERSATION_DISPLAYS, type ConversationDisplay } from "./contracts";
import { ProlificPid, ProlificRef } from "./prolific";

/**
 * The display study's session: one sitting, one short conversation about an
 * everyday problem, shown one way on the phone — between participants, so
 * each sees one view and never compares it with another. After it, a summary
 * and a few questions.
 *
 * WHICH VIEWS ARE COMPARED is a setup's (`study_design`), chosen by the
 * researchers on /researcher: a name, the views, the tasks, and the Prolific
 * completion code. Every session is filed under its setup, so no analysis
 * pools two sets of views, and a setup cannot change once it has a session.
 *
 * What crosses the wire between the session page (`/study/session`) and its
 * routes, and the session's shape. Pure: shared by the pages, the routes and
 * the database, and safe in the browser.
 */

/**
 * Bump when the questions change enough that answers should not be pooled.
 * Session-3 (29 Oct 2026): no one-tap prompts during the conversation, so the
 * ratings after it are the first time they are asked.
 * Session-4 (30 Oct 2026, after Prolific pilot run 1): the microphone is
 * muted during the game, the game waits for the agent to finish (up to
 * `GAME_GRACE_MS` past its deadline), and first words after it are an onset.
 * Resumption lags are not comparable with session-3's.
 */
export const SESSION_VERSION = "session-4";

/**
 * The tasks a session can have, by id. The words — what they read and what the
 * agent is told — are `SESSION_TASKS` in @voicemural/talkback/study-task.
 */
export const SESSION_TASK_IDS = [
  "trip",
  "birthday",
  "move",
  "dinners",
  "week",
  "city",
  "ownplan",
  "givenweek",
  "ownweek",
] as const;
export type SessionTaskId = (typeof SESSION_TASK_IDS)[number];

/**
 * Three kinds of task, so the views can be compared on more than one: "one"
 * plans one thing from a few sides (a trip: where, how, where to stay), the
 * way the pilots did; "several" is a handful of separate matters that
 * collide, the way a conversation spread over days touches many things, so it
 * brings up more topics and more returns to them; "reflect" looks back on a
 * week, open-ended, with few decisions to reach (added after Prolific pilot
 * run 1, 30 Oct 2026, for planning vs. reflection).
 */
export type SessionTaskKind = "one" | "several" | "reflect";
export const SESSION_TASK_KIND: Record<SessionTaskId, SessionTaskKind> = {
  trip: "one",
  birthday: "one",
  move: "one",
  dinners: "one",
  week: "several",
  city: "several",
  ownplan: "one",
  givenweek: "reflect",
  ownweek: "reflect",
};

/**
 * Whether a task is about the participant's own life ("own") or a situation
 * given to them ("given"). Crossed with planning vs. reflection: `trip` and
 * `ownplan` plan, `givenweek` and `ownweek` reflect.
 */
export type SessionTaskSource = "given" | "own";
export const SESSION_TASK_SOURCE: Record<SessionTaskId, SessionTaskSource> = {
  trip: "given",
  birthday: "given",
  move: "given",
  dinners: "given",
  week: "given",
  city: "given",
  ownplan: "own",
  givenweek: "given",
  ownweek: "own",
};

export function isSessionTaskId(value: unknown): value is SessionTaskId {
  return typeof value === "string" && (SESSION_TASK_IDS as readonly string[]).includes(value);
}

/**
 * Every view can be compared: each has a sentence for the brief before the
 * conversation (`DISPLAY_COPY` on the session page) and one for the blind
 * judge (`BLIND_DESCRIPTIONS`).
 */
export type SessionDisplay = ConversationDisplay;
export const SESSION_VIEWS = CONVERSATION_DISPLAYS;

/** A setup, as far as making its sessions goes. */
export interface SessionDesign {
  name: string;
  /** In the order the researchers put them; cell 0 is the first view with the first task. */
  views: readonly SessionDisplay[];
  tasks: readonly SessionTaskId[];
}

/**
 * Session-2's setup, the one every session was made in before setups could be
 * chosen: the chat — the baseline, the way a voice assistant's chat shows a
 * voice conversation — the topic line (structure instead of words) and the
 * topic line with uptake, over two of the tasks. Seeded by migration 0032.
 */
export const DEFAULT_DESIGN: SessionDesign = {
  name: "between",
  views: ["chat", "topics", "uptake"],
  tasks: ["trip", "birthday"],
};

/** Session-1's: four conversations, every view for every participant. Its links no longer open. */
export const LEGACY_DESIGN = "within";

/** Conversations in one session. */
export const SESSION_BLOCKS = 1;

/** How many different sessions a setup has: every view with every task. */
export function cellCount(design: Pick<SessionDesign, "views" | "tasks">): number {
  return design.views.length * design.tasks.length;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The view and task of a setup's cell `k` (`order_index`), any index wrapping
 * onto one of its cells.
 *
 * The view turns with every cell. While the two counts share no factor — three
 * views and two tasks — the task turns with every cell too, so any run of
 * cells covers the views and the tasks as evenly as it can, and the cells
 * still hold every pair once. When they do share one — four views and two
 * tasks — that would pair each view with one task for ever, so the task turns
 * once per round of the views instead.
 */
export function cellFor(
  design: Pick<SessionDesign, "views" | "tasks">,
  k: number,
): { display: SessionDisplay; task: SessionTaskId } {
  const n = cellCount(design);
  if (n === 0) throw new Error("a setup needs at least one view and one task");
  const cell = ((Math.trunc(k) % n) + n) % n;
  const { views, tasks } = design;
  const task =
    gcd(views.length, tasks.length) === 1 ? cell % tasks.length : Math.floor(cell / views.length) % tasks.length;
  return { display: views[cell % views.length]!, task: tasks[task]! };
}

export interface SessionBlockPlan {
  /** In the order they are done; 0, while a session is one conversation. */
  position: number;
  display: SessionDisplay;
  task: SessionTaskId;
}

/** The blocks of the session in a setup's cell `k`: its one conversation. */
export function blocksFor(design: Pick<SessionDesign, "views" | "tasks">, k: number): SessionBlockPlan[] {
  return [{ position: 0, ...cellFor(design, k) }];
}

/**
 * The cell a new session takes: the one held by the fewest sessions, the
 * lowest on a tie, so sessions made in a row go round the cells in turn and a
 * cell left short by a participant who gave up is the next one filled.
 * `held[k]` counts the sessions holding cell `k` (`SESSION_HOLD_MS`).
 */
export function leastFilledCell(held: readonly number[]): number {
  let best = 0;
  for (let k = 1; k < held.length; k++) if (held[k]! < held[best]!) best = k;
  return best;
}

/**
 * How long a session that is not complete still holds its cell. A Prolific
 * participant who gives up never says so; after this, their cell counts as
 * free again. Generous next to the 15 minutes a session takes, so nobody still
 * in one loses it.
 */
export const SESSION_HOLD_MS = 3 * 3_600_000;

/** A setup's name: also what every export calls it, so short and plain. */
export const DesignName = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, "lowercase letters, digits and dashes");

/** A Prolific completion code, as Prolific shows it on the study's page. */
export const CompletionCode = z.string().trim().regex(/^[A-Za-z0-9_-]{2,64}$/);

const distinct = <T>(items: readonly T[]) => new Set(items).size === items.length;

/** A setup as the researchers make it. Views and tasks in their order, each once. */
export const DesignInput = z.strictObject({
  name: DesignName,
  views: z.array(z.enum(SESSION_VIEWS)).min(1).max(SESSION_VIEWS.length).refine(distinct, "each view once"),
  tasks: z.array(z.enum(SESSION_TASK_IDS)).min(1).max(SESSION_TASK_IDS.length).refine(distinct, "each task once"),
  completionCode: CompletionCode.nullable().default(null),
  note: z.string().trim().max(500).nullable().default(null),
});
export type DesignInput = z.infer<typeof DesignInput>;

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
}

export const SESSION_TIMINGS: SessionTimings = {
  talkMinMs: 4 * 60_000,
  talkTargetMs: 5 * 60_000,
  talkCapMs: 7 * 60_000,
  gameEarliestMs: 135_000,
  gameLatestMs: 180_000,
  gameMinMs: 60_000,
  gameCapMs: 75_000,
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

/**
 * Past the deadline the game still waits for the agent to finish what it is
 * saying, but for a shorter quiet and only this long. Pilot run 1 (30 Oct
 * 2026): a game forced at the deadline cut the agent off mid-sentence (P02),
 * and its sentence was never said; this is the grace that lets it finish.
 */
export const GAME_GRACE_MS = 30_000;
/** The quiet that is enough once the deadline has passed. */
export const GAME_LATE_QUIET_MS = 500;

/**
 * Whether the game should interrupt now: a quiet moment once it may; past the
 * deadline, any short quiet; and past the grace, at once. `quietMs` counts
 * from the last moment either side was speaking or the agent was working out
 * a reply, so the game never lands on a reply that is about to start.
 */
export function gameDue(input: { elapsedMs: number; quietMs: number; timings: SessionTimings }): boolean {
  const { elapsedMs, quietMs, timings } = input;
  if (elapsedMs >= timings.gameLatestMs + GAME_GRACE_MS) return true;
  if (elapsedMs >= timings.gameLatestMs) return quietMs >= GAME_LATE_QUIET_MS;
  return elapsedMs >= timings.gameEarliestMs && quietMs >= GAME_QUIET_MS;
}

/* ---------------------------------------------------------------------------
 * Moments: what happened when, on the drive's clock
 * ------------------------------------------------------------------------- */

/**
 * What a moment is:
 * - `esm`: a one-tap prompt (`item` is its question; `value` 1-7, or null
 *   when it expired). Session-2's only: since session-3 nothing interrupts
 *   the conversation but the game, and these are still read from its moments.
 * - `game`: the interruption, from the pause to the end of its last round.
 * - `resume`: back in the conversation, the moment the game ends; answered
 *   at their first words.
 *
 * Session-1 also had `probe`, "where were you?" typed between the two. It
 * made them recall where they had got to before they picked the
 * conversation up, which is the very thing the resumption measures; it is
 * asked afterwards now (`GAME_QUESTIONS`).
 */
export const MOMENT_KINDS = ["esm", "game", "resume"] as const;
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

/**
 * About the game, asked after the conversation — after the summary, so they
 * cannot cue it — and only of a conversation the game interrupted.
 */
export const GAME_QUESTIONS = {
  beforeGame: {
    question: "Just before the game, what were you talking about, and where had you got to?",
    hint: "A few words is enough. “I don’t remember” is fine too.",
  },
  wayBack: {
    question: "When the game ended, how did you find your way back into the conversation?",
    hint: "A sentence or two.",
  },
} as const;
export type GameQuestionKey = keyof typeof GAME_QUESTIONS;

/** The secret in an invite link. Long enough not to be guessed. */
export const SessionCode = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Who arrived from Prolific: the three parameters it appends to the study's link. */
export const SessionProlific = z.object({
  pid: ProlificPid,
  studyId: ProlificRef.optional(),
  sessionId: ProlificRef.optional(),
});
export type SessionProlific = z.infer<typeof SessionProlific>;

/**
 * Consent given on the first page, for this browser's account: claim the
 * invite in the link, or — arriving from Prolific — take a session in the
 * setup that is running.
 */
export const SessionEnroll = z.union([
  z.object({ code: SessionCode, consent: z.literal(true) }),
  z.object({ prolific: SessionProlific, consent: z.literal(true) }),
]);
export type SessionEnroll = z.infer<typeof SessionEnroll>;

/** What a finished Prolific participant is given: the code, and the way back. */
export interface SessionCompletion {
  code: string;
  url: string;
}

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
  /** Absent for a conversation the game did not interrupt, like the two below. */
  pickup: Likert.optional(),
  /** Where they had got to before the game, recalled afterwards (`GAME_QUESTIONS`). */
  beforeGame: z.string().trim().min(1).max(OPEN_MAX_CHARS).optional(),
  /** How they found their way back in. */
  wayBack: z.string().trim().min(1).max(OPEN_MAX_CHARS).optional(),
  glance: Likert,
  /** What helped, or got in the way. Optional. */
  helped: z.string().trim().max(OPEN_MAX_CHARS).optional(),
});
export type BlockAnswers = z.infer<typeof BlockAnswers>;

/**
 * The end of the session. Session-1 ranked its four views here; with one view
 * each, there is nothing to rank.
 */
export const SessionFinal = z.strictObject({
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
