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

export const SURVEY_KEYS = ["initial", "week"] as const;
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

/*
 * The end-of-week questionnaire: how was it to choose?
 *
 * WHY IT EXISTS. The field week alternates by day between Souffleur picking
 * which subjects to raise sparks about (`sparkSelection: "suggested"`) and the
 * person picking them, by keeping them (`"chosen"`). The ledger counts what
 * was kept and pulled; it cannot say what choosing was LIKE, which is the
 * question the week is for — whether keeping felt like theirs, and what made
 * them keep one subject and let another go. This asks that, once, at the end,
 * and seeds the interview or focus group that follows.
 *
 * THE RATINGS are adapted from the Intrinsic Motivation Inventory (Ryan &
 * Deci): perceived choice, interest/enjoyment and value/usefulness, reworded
 * for keeping, plus three items of our own (`WEEK_ITEM_SCALES`). Seven points,
 * "not at all true" to "very true". `WEEK_REVERSED` are worded the other way
 * round: score them as 8 − x before pooling with the rest of their scale.
 * Too few items per scale for a reliability claim — they are there to be read
 * next to the answers in words, not instead of them.
 *
 * THE OPEN QUESTIONS ASK FOR INCIDENTS — one subject they kept, one they let
 * go, one question that stuck — rather than opinions about keeping in
 * general: a person recalls a moment far better than they summarise a week.
 */

export const WEEK_SURVEY_VERSION = "week-1";

export const WEEK_ITEMS = [
  "choice_own",
  "choice_had_to",
  "choice_enjoy",
  "choice_effort",
  "kept_value",
  "held_trust",
  "sparks_suggested_useful",
  "sparks_chosen_useful",
] as const;
export const WeekItem = z.enum(WEEK_ITEMS);
export type WeekItem = z.infer<typeof WeekItem>;

/** Worded the other way round: 8 − x before pooling. */
export const WEEK_REVERSED: readonly WeekItem[] = ["choice_had_to", "choice_effort"];

/** Which scale each item belongs to: the IMI's three, and ours. */
export const WEEK_ITEM_SCALES: Record<WeekItem, "choice" | "interest" | "value" | "load" | "trust" | "sparks"> = {
  choice_own: "choice",
  choice_had_to: "choice",
  choice_enjoy: "interest",
  choice_effort: "load",
  kept_value: "value",
  held_trust: "trust",
  sparks_suggested_useful: "sparks",
  sparks_chosen_useful: "sparks",
};

/** "If it stayed one way, which would you want?" */
export const WEEK_PREFERENCES = ["souffleur_picks", "i_pick", "no_difference", "unsure"] as const;
export type WeekPreference = (typeof WEEK_PREFERENCES)[number];

/** "How did you mostly keep things?" */
export const KEEP_WAYS = ["tap", "voice", "both", "neither"] as const;
export type KeepWay = (typeof KEEP_WAYS)[number];

export const WeekAnswers = z.object({
  ratings: z.partialRecord(WeekItem, z.number().int().min(1).max(7)).optional(),
  /** "How did it feel to choose what to keep, and to let the rest go?" */
  chooseFeel: Text.optional(),
  /** One subject they kept, and why that one. */
  keptIncident: Text.optional(),
  /** One they let Souffleur hold, and why. */
  heldIncident: Text.optional(),
  /** Whether something they kept came back to them later, and when. */
  keptAfter: Text.optional(),
  keepHow: z.enum(KEEP_WAYS).optional(),
  keepHowWhy: Text.optional(),
  /** A question that stuck, or one that missed. */
  sparkIncident: Text.optional(),
  preferred: z.enum(WEEK_PREFERENCES).optional(),
  preferredWhy: Text.optional(),
  change: Text.optional(),
  /** Whether they would join a conversation about the week. */
  interview: z.enum(["yes", "no"]).optional(),
  anythingElse: Text.optional(),
});
export type WeekAnswers = z.infer<typeof WeekAnswers>;

/** The answers' shape, per survey. */
export const SURVEY_ANSWERS = { initial: SurveyAnswers, week: WeekAnswers } as const;
export type SurveyAnswersOf<K extends SurveyKey> = z.infer<(typeof SURVEY_ANSWERS)[K]>;

const UpsertCommon = {
  version: z.string().min(1).max(32),
  /** True when they pressed Send; false or absent saves a draft. */
  submit: z.boolean().optional(),
};

/** `PUT /api/survey`: the whole document, every time, in its own survey's shape. */
export const SurveyResponseUpsert = z.discriminatedUnion("survey", [
  z.object({ survey: z.literal("initial"), answers: SurveyAnswers, ...UpsertCommon }),
  z.object({ survey: z.literal("week"), answers: WeekAnswers, ...UpsertCommon }),
]);
export type SurveyResponseUpsert = z.infer<typeof SurveyResponseUpsert>;

/** `GET /api/survey?survey=…`: what was last saved, or null. */
export interface SurveyResponseView<A = SurveyAnswers> {
  version: string;
  answers: A;
  submittedAt: string | null;
  updatedAt: string;
}

/** An empty document, for a first visit. */
export function emptySurveyAnswers(): SurveyAnswers {
  return { moments: [] };
}

/** An empty document of either survey. */
export function emptyAnswers<K extends SurveyKey>(survey: K): SurveyAnswersOf<K> {
  return (survey === "initial" ? emptySurveyAnswers() : {}) as SurveyAnswersOf<K>;
}

/** Whether a week document says anything at all: Send is offered only then. */
export function weekAnswered(answers: WeekAnswers): boolean {
  return Object.entries(answers).some(([key, value]) =>
    key === "ratings"
      ? Object.keys((value as object | undefined) ?? {}).length > 0
      : typeof value === "string"
        ? value.trim().length > 0
        : value !== undefined,
  );
}

/** A rating as it pools with its scale: reversed items turned round. */
export function scoredRating(item: WeekItem, value: number): number {
  return WEEK_REVERSED.includes(item) ? 8 - value : value;
}
