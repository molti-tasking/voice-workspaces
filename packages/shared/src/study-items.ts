import { z } from "zod";

/**
 * The single-item measures the study asks around a drive.
 *
 * WHY SINGLE ITEMS, and why these three. The thing being measured is whether
 * the system RELIEVES the person, not whether they got more done. Pilot 01
 * measured only the system — latency, turn counts, decline rate — and every
 * one of those numbers was healthy on a drive where the participant was left
 * waiting in silence, could not tell working from broken, and could not get an
 * answer to their own answer. None of that is visible without asking them.
 *
 * A single item per construct, asked twice a minute apart, is what a person
 * will actually answer in a car. A validated multi-item scale is better
 * psychometrics and worse data, because it will not be filled in.
 *
 * THE WORDING LIVES HERE, and the KEY is what is stored. `study_response.item`
 * holds `mental_load`, never the sentence, so rewording a question next month
 * does not fork the series — and the wording is in one place, so the recorder
 * and the participant sheet cannot drift apart. Bump `STUDY_ITEMS_VERSION`
 * when a wording change is big enough that the two halves should not be
 * pooled.
 *
 * Pure: no I/O and no db import, because the recorder is a client component.
 */

export const STUDY_ITEMS_VERSION = "items-1";

/** Every rating in the study is on this scale. Stored per row all the same. */
export const STUDY_SCALE_MAX = 7;

export const StudyResponsePhase = z.enum(["pre", "post", "day7"]);
export type StudyResponsePhase = z.infer<typeof StudyResponsePhase>;

export interface StudyItem {
  /** The stable key. This is what reaches the database. */
  key: string;
  /** What the participant reads. */
  question: string;
  /** The ends of the scale, low first. Spoken aloud nowhere; read on screen. */
  anchors: [low: string, high: string];
  /** When it is asked. `mental_load` is the only one asked twice. */
  phases: readonly StudyResponsePhase[];
}

/**
 * Mental load, asked before and after the same drive.
 *
 * The primary relief measure that a person can report. Pre/post rather than
 * post alone because the absolute number says almost nothing — people differ
 * enormously in what they call "a lot" — while the CHANGE across one session
 * is the offloading claim stated as an observable.
 */
export const MENTAL_LOAD: StudyItem = {
  key: "mental_load",
  question: "How much are you currently holding in your head?",
  anchors: ["Almost nothing", "More than I can keep track of"],
  phases: ["pre", "post"],
};

/**
 * Whether the person could tell the system was still working.
 *
 * The direct report of the failure Pilot 01 produced mechanically: a
 * tool-backed turn took a median of 8.4s against 1.3s without, and nothing was
 * spoken in between, so working and broken sounded identical. The liveness
 * fillers are the fix; this is how we find out whether they worked.
 */
export const LIVENESS_PERCEIVED: StudyItem = {
  key: "liveness_perceived",
  question: "Could you tell whether the system was still working?",
  anchors: ["Never could tell", "Always obvious"],
  phases: ["post"],
};

/**
 * Whether the person could correct the system when it was wrong.
 *
 * The steerability measure as the person experienced it, next to the
 * behavioural correction rate the metrics compute from the ledger. The two
 * disagreeing is itself the finding: corrections that land while the person
 * still feels unable to steer means they are paying for every one.
 */
export const CAN_CORRECT: StudyItem = {
  key: "can_correct",
  question: "Could you correct the system when it was wrong?",
  anchors: ["Not at all", "Whenever I needed to"],
  phases: ["post"],
};

export const STUDY_ITEMS: readonly StudyItem[] = [
  MENTAL_LOAD,
  LIVENESS_PERCEIVED,
  CAN_CORRECT,
];

/** The items asked at one phase, in the order they should be shown. */
export function itemsForPhase(phase: StudyResponsePhase): StudyItem[] {
  return STUDY_ITEMS.filter((item) => item.phases.includes(phase));
}

/** Narrow an untrusted string to a known item key. */
export function isStudyItem(key: string): boolean {
  return STUDY_ITEMS.some((item) => item.key === key);
}

/**
 * The three debrief questions, asked ALOUD after Stop with the microphone
 * still open.
 *
 * Moved here from `/study`, which is where participants read them, so the
 * recorder shows the same three words for word. They are answered in speech,
 * not on a scale: the answers are content by design and the participant sheet
 * says researchers read them, which is precisely why the debrief has to be a
 * marked window inside the recording rather than an unrecorded conversation
 * after it (see `capture_session.debrief_started_offset_ms`).
 */
export const DEBRIEF_QUESTIONS: readonly string[] = [
  "What did you want it to do that it couldn't?",
  "What did it do that you didn't ask for?",
  "What would you make into a thing, if that were easy?",
];

/** What the recorder posts to `/api/study/response`. */
export const StudyResponseCreate = z.object({
  captureSessionId: z.uuid().nullable().optional(),
  phase: StudyResponsePhase,
  item: z.string().min(1).max(64).refine(isStudyItem, "unknown study item"),
  value: z.number().int().min(1).max(STUDY_SCALE_MAX),
  scaleMax: z.number().int().min(2).max(100).default(STUDY_SCALE_MAX),
});
export type StudyResponseCreate = z.infer<typeof StudyResponseCreate>;

/** What the day-7 review posts, per card. `lost` is the failure measure. */
export const StudyItemReviewCreate = z.object({
  cardId: z.string().min(1).max(128),
  captureSessionId: z.uuid().nullable().optional(),
  outcome: z.enum(["done", "open", "lost"]),
});
export type StudyItemReviewCreate = z.infer<typeof StudyItemReviewCreate>;

/** What days 2–6 are allowed to record: that something was opened. */
export const StudyEventCreate = z.object({
  kind: z.enum(["board_open", "card_open"]),
  cardId: z.string().min(1).max(128).nullable().optional(),
});
export type StudyEventCreate = z.infer<typeof StudyEventCreate>;
