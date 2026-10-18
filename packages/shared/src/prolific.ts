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
  /** It has ended: their judgement of how much they will remember, and the questionnaire. */
  z.object({
    step: z.literal("finished"),
    judgmentOfLearning: Likert,
    questionnaire: z.lazy(() => ProlificQuestionnaire),
  }),
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
  /**
   * The manipulation check, asked in both arms: did they see question cards
   * during the conversation? The control arm never had any.
   */
  noticedCards: z.enum(["yes", "no", "unsure"]),
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

/* ---------------------------------------------------------------------------
 * The questionnaire after the conversation (end of part 1)
 * ------------------------------------------------------------------------- */

/**
 * Raw NASA-TLX (Hart & Staveland 1988; "raw" without the pairwise weighting,
 * Hart 2006): six subscales, each 0-100 in steps of 5. The between-arm
 * question it answers: did the sparks add workload?
 *
 * Performance is anchored "Perfect" (0) to "Failure" (100), as in the
 * original, so a higher score is more workload on every subscale.
 */
export const TLX_ITEMS = [
  { key: "mental", label: "Mental demand", question: "How mentally demanding was the task?", low: "Very low", high: "Very high" },
  { key: "physical", label: "Physical demand", question: "How physically demanding was the task?", low: "Very low", high: "Very high" },
  { key: "temporal", label: "Temporal demand", question: "How hurried or rushed was the pace of the task?", low: "Very low", high: "Very high" },
  { key: "performance", label: "Performance", question: "How successful were you in accomplishing what you were asked to do?", low: "Perfect", high: "Failure" },
  { key: "effort", label: "Effort", question: "How hard did you have to work to accomplish your level of performance?", low: "Very low", high: "Very high" },
  { key: "frustration", label: "Frustration", question: "How insecure, discouraged, irritated, stressed and annoyed were you?", low: "Very low", high: "Very high" },
] as const;
export type TlxKey = (typeof TLX_ITEMS)[number]["key"];

/**
 * The System Usability Scale (Brooke 1996), ten items, 1 (strongly disagree)
 * to 5 (strongly agree), worded as published with "system" — the convention
 * that keeps scores comparable with the SUS literature.
 */
export const SUS_ITEMS = [
  "I think that I would like to use this system frequently.",
  "I found the system unnecessarily complex.",
  "I thought the system was easy to use.",
  "I think that I would need the support of a technical person to be able to use this system.",
  "I found the various functions in this system were well integrated.",
  "I thought there was too much inconsistency in this system.",
  "I would imagine that most people would learn to use this system very quickly.",
  "I found the system very cumbersome to use.",
  "I felt very confident using the system.",
  "I needed to learn a lot of things before I could get going with this system.",
] as const;

/**
 * An instructed-response item shown among the SUS items (not part of the
 * score): "please select Strongly disagree". The answer is kept, and the
 * export marks who passed; nobody is turned away on it.
 */
export const ATTENTION_ITEM = "To show that you are reading carefully, please select “Strongly disagree” for this statement.";
/** The answer the attention item asks for. */
export const ATTENTION_EXPECTED = 1;
/** Where among the SUS items it is shown (after this many). */
export const ATTENTION_AFTER = 6;

const Tlx = z.number().int().min(0).max(100).refine((n) => n % 5 === 0, "steps of 5");
const Agreement = z.number().int().min(1).max(5);

export const ProlificQuestionnaire = z.object({
  tlx: z.strictObject({
    mental: Tlx,
    physical: Tlx,
    temporal: Tlx,
    performance: Tlx,
    effort: Tlx,
    frustration: Tlx,
  }),
  /** The ten SUS answers, in the published order. */
  sus: z.array(Agreement).length(SUS_ITEMS.length),
  attention: Agreement,
});
export type ProlificQuestionnaire = z.infer<typeof ProlificQuestionnaire>;

/** Raw TLX: the mean of the six subscales, 0-100. */
export function rawTlx(tlx: ProlificQuestionnaire["tlx"]): number {
  const values = TLX_ITEMS.map((item) => tlx[item.key]);
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

/** The SUS score, 0-100: odd items score x-1, even items 5-x, the sum times 2.5. */
export function susScore(sus: readonly number[]): number {
  const sum = sus.reduce((total, x, i) => total + (i % 2 === 0 ? x - 1 : 5 - x), 0);
  return sum * 2.5;
}
