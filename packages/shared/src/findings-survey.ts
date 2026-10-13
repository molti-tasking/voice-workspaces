import { z } from "zod";

/**
 * The findings survey: four early findings, put back to the people who drove.
 *
 * WHY IT EXISTS. The instruments inside the study came back thin — six rated
 * drives, an empty day-7 review, no submitted `initial` survey — and most of
 * the gap sits at the two moments the design is about: arriving at the end of
 * a drive, and coming back to the desk. This asks everyone the same short set
 * of questions about what the study saw, so a participant who drove once and
 * one who drove thirty times can both answer, and the answers seed a workshop
 * the next day.
 *
 * ANONYMOUS, unlike `initial`. No account is needed and none is recorded: the
 * invitation promises it, and the people answering are colleagues of the
 * person reading the answers. `anonymous_survey_response` holds the document
 * with no user, and only the DAY it was sent.
 *
 * KEYS ARE STORED, WORDING IS NOT. The sentences live in
 * `apps/web/src/app/survey/findings/wording.ts`, which both the form and the
 * dashboard read. Bump `FINDINGS_VERSION` when a rewording is big enough that
 * answers before and after should not be read together.
 *
 * EVERYTHING IS OPTIONAL, but a submission must answer something — an empty
 * document is a row that only adds to the count.
 */

export const FINDINGS_SURVEY = "findings" as const;
export const FINDINGS_VERSION = "findings-1";

const Text = z.string().max(4000);
const Short = z.string().max(300);

/** "How much did you use Souffleur?" */
export const USAGE_LEVELS = ["once_or_twice", "a_handful", "regularly"] as const;
export type UsageLevel = (typeof USAGE_LEVELS)[number];

/** "It didn't come up for me" — kept apart from the 1–5 scale, never averaged in. */
export const NOT_APPLICABLE = "na" as const;

/** "What shaped how much you used it?" Multi-select. */
export const USE_REASONS = [
  "part_of_commute",
  "unsure_what_for",
  "nothing_on_mind",
  "forgot",
  "too_much_effort",
  "unsure_it_keeps",
  "did_not_work",
  "not_alone",
  "not_recorded",
  "other",
] as const;
export type UseReason = (typeof USE_REASONS)[number];

/** "When you arrived, what usually happened?" */
export const ARRIVALS = ["stop_and_reflect", "stop_and_skip", "forgot_it_was_on", "left_it", "other"] as const;
export type Arrival = (typeof ARRIVALS)[number];

/** "Where should a drive be wrapped up?" */
export const WRAP_UPS = ["in_the_car", "after_arriving", "at_the_desk", "not_at_all"] as const;
export type WrapUp = (typeof WRAP_UPS)[number];

/**
 * "While driving, would you hand this to a voice partner?"
 *
 * Ordered from holding to thinking on purpose — the rows are the line the
 * study is about, and the dashboard re-sorts them by the answers.
 */
export const HAND_OFF_TASKS = [
  "remember_task",
  "where_left_off",
  "sum_up",
  "ask_questions",
  "suggest_topic",
  "draft_message",
  "what_matters",
] as const;
export type HandOffTask = (typeof HAND_OFF_TASKS)[number];

/** An ordered scale: hand it over, hand it over and check, keep it. */
export const HAND_OFF_ANSWERS = ["gladly", "check_later", "myself"] as const;
export type HandOffAnswer = (typeof HAND_OFF_ANSWERS)[number];

/** "If it stayed available, would you keep using it?" */
export const KEEP_USING = ["regularly", "certain_drives", "no"] as const;
export type KeepUsing = (typeof KEEP_USING)[number];

export const FindingsAnswers = z.object({
  usage: z.enum(USAGE_LEVELS).optional(),
  /** Finding 1, 1–5 how well it matches, or that it never came up. */
  silenceMatch: z.union([z.number().int().min(1).max(5), z.literal(NOT_APPLICABLE)]).optional(),
  silenceWanted: Text.optional(),
  /** Finding 2. */
  useReasons: z.array(z.enum(USE_REASONS)).max(USE_REASONS.length).optional(),
  useReasonOther: Short.optional(),
  learned: Text.optional(),
  /** Finding 3. */
  arrival: z.enum(ARRIVALS).optional(),
  arrivalOther: Short.optional(),
  wrapUp: z.enum(WRAP_UPS).optional(),
  wrapUpWhy: Text.optional(),
  /** Finding 4. */
  handOff: z.partialRecord(z.enum(HAND_OFF_TASKS), z.enum(HAND_OFF_ANSWERS)).optional(),
  neverDo: Text.optional(),
  /** UMUX-Lite, both items on 1–7. */
  umuxCapabilities: z.number().int().min(1).max(7).optional(),
  umuxEase: z.number().int().min(1).max(7).optional(),
  keepUsing: z.enum(KEEP_USING).optional(),
  /** Carried into the next day's workshop. */
  workshopQuestion: Text.optional(),
});
export type FindingsAnswers = z.infer<typeof FindingsAnswers>;

/** The free-text fields, which the dashboard lists rather than counts. */
export const FINDINGS_TEXT_FIELDS = [
  "silenceWanted",
  "useReasonOther",
  "learned",
  "arrivalOther",
  "wrapUpWhy",
  "neverDo",
  "workshopQuestion",
] as const satisfies readonly (keyof FindingsAnswers)[];
export type FindingsTextField = (typeof FINDINGS_TEXT_FIELDS)[number];

/** `POST /api/survey/findings`: the whole document, every time. */
export const FindingsSubmission = z.object({
  /**
   * Made by the browser and kept there, so sending again corrects the answer
   * rather than adding a second one. It is not linked to anything else.
   */
  id: z.uuid(),
  version: z.string().min(1).max(32),
  answers: FindingsAnswers,
  /** A field no person can see. Anything in it is a bot. */
  website: z.string().max(200).optional(),
});
export type FindingsSubmission = z.infer<typeof FindingsSubmission>;

/**
 * Whether a document answers anything at all.
 *
 * Blank text and an empty selection are not answers: a form opened and sent
 * untouched should not count as a respondent.
 */
export function hasAnyAnswer(answers: FindingsAnswers): boolean {
  return Object.values(answers).some((value) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
}
