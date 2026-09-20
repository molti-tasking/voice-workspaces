import { z } from "zod";

/**
 * The single-item measures the study asks around a drive.
 *
 * FIVE ITEMS, and the count is a design decision rather than an oversight.
 * One before a drive and four after it is about twenty seconds of tapping,
 * which is what a person will do every day for a week. A validated multi-item
 * scale per construct would be better psychometrics and worse data, because by
 * day three it would not be filled in.
 *
 * WHY SINGLE ITEMS, AND WHY THESE. The thing being measured is whether the
 * system RELIEVES the person, not whether they got more done. Pilot 01
 * measured only the system — latency, turn counts, decline rate — and every
 * one of those numbers was healthy on a drive where the participant was left
 * waiting in silence, could not tell working from broken, and could not get an
 * answer to their own answer. None of that is visible without asking them.
 *
 * AND RELIEF OF WHAT. The last two items exist because "relief" on its own is
 * not a goal worth having: a system that did the thinking would score
 * beautifully on mental load. What should come off the person is what they are
 * HOLDING — the tracking, the remembering, the re-deriving. What must not come
 * off them is the thinking, which is the thing they opened the app to do. See
 * EVALUATION_PLAN §10; `thinking_moved` and `did_my_thinking` are those two
 * halves asked separately, because a single "was it helpful" cannot tell them
 * apart.
 *
 * THE WORDING LIVES HERE, and the KEY is what is stored. `study_response.item`
 * holds `mental_load`, never the sentence, so rewording a question next month
 * does not fork the series — and the wording is in one place, so the recorder
 * and the participant sheet cannot drift apart. Bump `STUDY_ITEMS_VERSION`
 * when a wording change is big enough that the two halves should not be
 * pooled.
 *
 * THE VERSION TRACKS WORDING, NOT MEMBERSHIP. Adding an item leaves it alone:
 * the series already running are unaffected, and the new one simply starts
 * later. Only rewording an existing question forks anything.
 *
 * THE SPOKEN DEBRIEF QUESTIONS ARE NOT HERE. They live in
 * `apps/web/src/lib/study/debrief.ts`, beside the window they are asked in,
 * because `/study` promises those three sentences verbatim in the information
 * sheet. These are the RATINGS that bracket them — taps on a scale, not
 * speech — and the two are answered in different ways for different reasons.
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
  /**
   * WHICH END IS THE GOOD END.
   *
   * Two of these items are reverse-scored — more load and more of the thinking
   * taken over are both failures — and mixing directions without saying so is
   * the classic way a scale gets averaged into nonsense. Stated per item, in
   * the same file as the wording, so the analysis reads it from the data
   * rather than remembering it.
   */
  higherIsBetter: boolean;
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
  higherIsBetter: false,
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
  higherIsBetter: true,
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
  higherIsBetter: true,
};

/**
 * Whether talking it through moved the thinking on.
 *
 * THE MEASURE THE FIRST VERSION OF THIS STUDY WAS MISSING. Everything else
 * here asks whether the system worked and whether it took load off; none of it
 * asks whether the thing the person came to do — think a problem through out
 * loud — actually happened. Thinking aloud is not narration of a finished
 * thought, it is where a difficult thought gets formed (see EVALUATION_PLAN
 * §10), and a system that captures beautifully while the thinking goes nowhere
 * has failed at the only job that matters.
 *
 * Deliberately "further than on your own", not "did you have good ideas": the
 * comparison the participant can actually make is against the drive they would
 * otherwise have spent thinking in silence.
 */
export const THINKING_MOVED: StudyItem = {
  key: "thinking_moved",
  question: "Did talking it through move your thinking on?",
  anchors: ["No further than alone", "Much further"],
  phases: ["post"],
  higherIsBetter: true,
};

/**
 * Whether it did thinking the person wanted to do themselves.
 *
 * REVERSE-SCORED, and the counterweight to every other measure here. Offloading
 * what you are HOLDING is the point. Offloading the thinking itself is the
 * failure the wider literature on cognitive offloading keeps finding: people
 * produce better artefacts with an assistant, learn less from them, and
 * self-correct less often. A system optimised only for relief would score well
 * on mental load by doing the work — and that is the outcome this item exists
 * to catch.
 *
 * Asked as a behaviour ("did it do"), not as a judgement ("was it too
 * intrusive"), because people are reliably poor at rating intrusiveness and
 * quite good at saying whether something was taken off them.
 */
export const DID_MY_THINKING: StudyItem = {
  key: "did_my_thinking",
  question: "Did it do thinking you wanted to do yourself?",
  anchors: ["Never", "Often"],
  phases: ["post"],
  higherIsBetter: false,
};

export const STUDY_ITEMS: readonly StudyItem[] = [
  MENTAL_LOAD,
  LIVENESS_PERCEIVED,
  CAN_CORRECT,
  THINKING_MOVED,
  DID_MY_THINKING,
];

/** The items asked at one phase, in the order they should be shown. */
export function itemsForPhase(phase: StudyResponsePhase): StudyItem[] {
  return STUDY_ITEMS.filter((item) => item.phases.includes(phase));
}

/** Narrow an untrusted string to a known item key. */
export function isStudyItem(key: string): boolean {
  return STUDY_ITEMS.some((item) => item.key === key);
}

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
