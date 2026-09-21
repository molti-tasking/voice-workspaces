import { z } from "zod";

/**
 * The initial-use survey: where and when did you use it, and what happened.
 *
 * WHY IT EXISTS. The system used to guess where a person was — driving,
 * walking, at a desk — from the accelerometer, and tune itself to the guess.
 * That was taken out (Sep 2026). The question did not go away; it moved here,
 * and is asked of the person afterwards, which is the only place it can be
 * answered honestly: "where and when did you actually use this, and what was
 * it like in those moments?"
 *
 * THE SHAPE, and why it is a list. One person's use is several MOMENTS, each
 * with its own where, when and story, and the interesting variance is between
 * them — the same person in a car on Tuesday and at a desk on Thursday. So
 * the document is a list of moments, each asked about in the same depth, and
 * a short set of overall questions at the end.
 *
 * KEYS ARE STORED, WORDING IS NOT. `survey_response.answers` holds these keys;
 * the sentences live in the page beside the inputs. Bump `SURVEY_VERSION`
 * when a rewording is big enough that answers before and after should not
 * be read together.
 *
 * EVERYTHING IS OPTIONAL. A half-filled survey is a draft worth keeping, and
 * a required field is how a phone-sized form is abandoned at question four.
 * Length caps are generous; they are there against a paste, not a person.
 */

export const SURVEY_VERSION = "initial-1";

export const SURVEY_KEYS = ["initial"] as const;
export const SurveyKey = z.enum(SURVEY_KEYS);
export type SurveyKey = z.infer<typeof SurveyKey>;

const Text = z.string().max(4000);
const Short = z.string().max(300);

/** Where they were. `other` carries its own words in `whereOther`. */
export const MOMENT_PLACES = [
  "driving",
  "walking",
  "public_transport",
  "at_home",
  "at_a_desk",
  "other",
] as const;
export const MomentPlace = z.enum(MOMENT_PLACES);
export type MomentPlace = z.infer<typeof MomentPlace>;

/** Whether they were mid-task or had set time aside for it. */
export const MOMENT_ATTENTION = ["hands_and_eyes_busy", "hands_busy", "fully_on_it"] as const;
export const MomentAttention = z.enum(MOMENT_ATTENTION);
export type MomentAttention = z.infer<typeof MomentAttention>;

/** What they looked at afterwards, if anything. Multi-select. */
export const AFTERWARDS = ["board", "draft", "transcript", "nothing"] as const;
export const Afterwards = z.enum(AFTERWARDS);
export type Afterwards = z.infer<typeof Afterwards>;

export const SurveyMoment = z.object({
  /** A client-generated id so a moment keeps its identity while being edited. */
  id: z.string().min(1).max(64),
  /** "Tuesday morning, on the way in." Free text; a date picker is a chore. */
  when: Short.optional(),
  where: MomentPlace.optional(),
  whereOther: Short.optional(),
  attention: MomentAttention.optional(),
  /** What was on their mind — the thing they were trying to work out. */
  onMind: Text.optional(),
  /** What they said to it, roughly. */
  said: Text.optional(),
  /** What it said or did back. */
  itDid: Text.optional(),
  /** 1–7: did that help. */
  helped: z.number().int().min(1).max(7).optional(),
  helpedWhy: Text.optional(),
  /** The thing they wanted it to do and it did not. */
  wanted: Text.optional(),
  afterwards: z.array(Afterwards).max(AFTERWARDS.length).optional(),
});
export type SurveyMoment = z.infer<typeof SurveyMoment>;

export const SurveyAnswers = z.object({
  moments: z.array(SurveyMoment).max(20).default([]),
  /** "If you told a friend what this thing is, what would you say?" */
  describe: Text.optional(),
  /** "What would make you pick it up again tomorrow?" */
  again: Text.optional(),
  anythingElse: Text.optional(),
});
export type SurveyAnswers = z.infer<typeof SurveyAnswers>;

/** `PUT /api/survey`: the whole document, every time. */
export const SurveyResponseUpsert = z.object({
  survey: SurveyKey,
  version: z.string().min(1).max(32),
  answers: SurveyAnswers,
  /** True when they pressed Send; false or absent saves a draft. */
  submit: z.boolean().optional(),
});
export type SurveyResponseUpsert = z.infer<typeof SurveyResponseUpsert>;

/** `GET /api/survey?survey=initial`: what was last saved, or null. */
export interface SurveyResponseView {
  version: string;
  answers: SurveyAnswers;
  submittedAt: string | null;
  updatedAt: string;
}

/** An empty document, for a first visit. */
export function emptySurveyAnswers(): SurveyAnswers {
  return { moments: [] };
}
