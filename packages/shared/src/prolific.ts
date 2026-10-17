import { z } from "zod";

/**
 * The Prolific recall study: what crosses the wire between the participant's
 * browser and the server (PROLIFIC.md).
 *
 * Two parts. Part 1 is one conversation about a fixed task, with the sparks on
 * or off. Part 2, a day or so later, asks what they remember: a free recall
 * first, before any cue, then the drive's recall probes, then the closing
 * questions below.
 *
 * Pure: shared by the pages and the routes, and safe in the browser.
 */

/** Bump when the closing questions change enough that answers should not be pooled. */
export const PROLIFIC_VERSION = "prolific-1";

export const PROLIFIC_ARMS = ["control", "sparks"] as const;
export type ProlificArm = (typeof PROLIFIC_ARMS)[number];

/**
 * A Prolific participant ID as it arrives in `PROLIFIC_PID`.
 *
 * Real ones are 24 hex characters. Anything short and URL-safe is accepted so
 * a researcher can walk through the study as `test-anton`; the arm is still
 * assigned the same way, and `pnpm study:prolific` marks such rows as tests.
 */
export const ProlificPid = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);

/** Whether a PID looks like one Prolific issues, rather than a researcher's test ID. */
export function isRealProlificPid(pid: string): boolean {
  return /^[0-9a-f]{24}$/.test(pid);
}

/** The other two parameters Prolific appends to a study URL. Optional: kept if present. */
export const ProlificRef = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/**
 * The arm with fewer participants, so a small study stays balanced; a tie is
 * broken at random. `random` is injectable for the tests.
 */
export function chooseArm(
  counts: Record<ProlificArm, number>,
  random: () => number = Math.random,
): ProlificArm {
  if (counts.control < counts.sparks) return "control";
  if (counts.sparks < counts.control) return "sparks";
  return random() < 0.5 ? "control" : "sparks";
}

const Likert = z.number().int().min(1).max(7);

/** Enrolment, from the consent page. A guest account must already exist. */
export const ProlificEnroll = z.object({
  pid: ProlificPid,
  studyId: ProlificRef.optional(),
  sessionId: ProlificRef.optional(),
  consent: z.literal(true),
  /** Outside production only (`PROLIFIC_ALLOW_ARM_PARAM`): pin the arm to test it. */
  arm: z.enum(PROLIFIC_ARMS).optional(),
});
export type ProlificEnroll = z.infer<typeof ProlificEnroll>;

/** The end of part 1. */
export const ProlificPart1 = z.discriminatedUnion("step", [
  /** The conversation has started: which drive it is. */
  z.object({ step: z.literal("started"), captureSessionId: z.uuid() }),
  /** It has ended, with their judgement of how much they will remember. */
  z.object({ step: z.literal("finished"), judgmentOfLearning: Likert }),
]);
export type ProlificPart1 = z.infer<typeof ProlificPart1>;

/** Free recall: long enough to mean something, bounded so a paste cannot flood a row. */
export const FREE_RECALL_MIN_CHARS = 40;
export const FREE_RECALL_MAX_CHARS = 8000;

/**
 * The closing questions of part 2, all 1-7 except where noted.
 *
 * `rehearsed` is the validity check: a participant who wrote the conversation
 * down, looked the topic up or talked it over since part 1 has practised it,
 * and their recall measures that practice as much as the conversation.
 */
export const ProlificClosing = z.object({
  /** "How much did you take away from yesterday's conversation?" */
  tookAway: Likert,
  /** "The ideas from the conversation feel like my own." */
  ownIdeas: Likert,
  /** "The assistant did most of the thinking." */
  assistantThought: Likert,
  /** Sparks arm only: "The question cards helped me think it through." Null in the control arm. */
  cardsHelped: Likert.nullable(),
  /** Since part 1: wrote anything down, looked it up, or talked it over with someone. */
  rehearsed: z.boolean(),
  comment: z.string().max(2000).optional(),
});
export type ProlificClosing = z.infer<typeof ProlificClosing>;

/** Part 2, step by step. Every step names the participant by PID: their cookie may be gone. */
export const ProlificPart2 = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("begin"),
    pid: ProlificPid,
    studyId: ProlificRef.optional(),
    sessionId: ProlificRef.optional(),
  }),
  z.object({
    step: z.literal("free_recall"),
    pid: ProlificPid,
    text: z.string().trim().min(FREE_RECALL_MIN_CHARS).max(FREE_RECALL_MAX_CHARS),
    confidence: Likert,
  }),
  /** One recall probe, in the same order `/api/recall/[id]` enforces. */
  z.object({ step: z.literal("probe_confidence"), pid: ProlificPid, probeId: z.uuid(), confidence: Likert }),
  z.object({ step: z.literal("probe_reveal"), pid: ProlificPid, probeId: z.uuid() }),
  z.object({
    step: z.literal("probe_answer"),
    pid: ProlificPid,
    probeId: z.uuid(),
    selfAccuracy: Likert,
    provenance: z.enum(["mine", "souffleur", "both", "unsure"]),
  }),
  z.object({ step: z.literal("closing"), pid: ProlificPid, answers: ProlificClosing }),
]);
export type ProlificPart2 = z.infer<typeof ProlificPart2>;

/** Where Prolific takes a finished participant, with the code that marks the submission complete. */
export function prolificCompletionUrl(code: string): string {
  return `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(code)}`;
}
