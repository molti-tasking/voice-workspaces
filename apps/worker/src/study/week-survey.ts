/**
 * The end-of-week questionnaire, out of `survey_response`, for analysis.
 *
 * Two shapes, on purpose:
 *
 * - `weekRows`: one CSV row per participant, the CLOSED answers only — each
 *   rating as given, each scale's mean with the reversed items turned round
 *   (`scoredRating`), the preference, how they kept, whether they would be
 *   interviewed. Numbers and enums, so it can sit next to `study:metrics`.
 * - `weekTexts`: the same people's words, one record each. The questionnaire
 *   asks for them and the people answering know they are read — unlike a
 *   drive's transcript — but they are still sentences, so they come out only
 *   when asked for (`--text`), into the gitignored `storage/`, like Prolific's.
 *
 * Keyed by the participant's pseudonym where they have one, by user id where
 * they do not; drafts are included and marked, because a half-filled
 * questionnaire still says something.
 */
import { eq, getDb } from "@voicemural/db";
import { surveyResponse, user } from "@voicemural/db/schema";
import {
  WEEK_ITEMS,
  WEEK_ITEM_SCALES,
  WeekAnswers,
  scoredRating,
  type WeekItem,
} from "@voicemural/shared";

export interface WeekResponse {
  who: string;
  version: string;
  submittedAt: Date | null;
  answers: WeekAnswers;
}

type Row = Record<string, string | number | boolean | null>;

const SCALES = [...new Set(Object.values(WEEK_ITEM_SCALES))];

const TEXT_FIELDS = [
  "chooseFeel",
  "keptIncident",
  "heldIncident",
  "keptAfter",
  "keepHowWhy",
  "sparkIncident",
  "preferredWhy",
  "change",
  "anythingElse",
] as const satisfies readonly (keyof WeekAnswers)[];

export async function loadWeekResponses(): Promise<WeekResponse[]> {
  const rows = await getDb()
    .select({
      userId: surveyResponse.userId,
      participantId: user.studyParticipantId,
      version: surveyResponse.version,
      submittedAt: surveyResponse.submittedAt,
      answers: surveyResponse.answers,
    })
    .from(surveyResponse)
    .innerJoin(user, eq(user.id, surveyResponse.userId))
    .where(eq(surveyResponse.survey, "week"))
    .orderBy(surveyResponse.createdAt);
  return rows.map((r) => {
    const parsed = WeekAnswers.safeParse(r.answers);
    return {
      who: r.participantId ?? r.userId,
      version: r.version,
      submittedAt: r.submittedAt,
      answers: parsed.success ? parsed.data : {},
    };
  });
}

/** The closed answers, one row per person. */
export function weekRows(responses: WeekResponse[]): Row[] {
  return responses.map(({ who, version, submittedAt, answers }) => {
    const ratings = answers.ratings ?? {};
    const row: Row = {
      participant: who,
      version,
      submitted: submittedAt !== null,
      submitted_on: submittedAt?.toISOString().slice(0, 10) ?? null,
    };
    for (const item of WEEK_ITEMS) row[item] = ratings[item] ?? null;
    for (const scale of SCALES) {
      const scored = (Object.keys(ratings) as WeekItem[])
        .filter((item) => WEEK_ITEM_SCALES[item] === scale)
        .map((item) => scoredRating(item, ratings[item]!));
      row[`scale_${scale}`] =
        scored.length > 0 ? Number((scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(2)) : null;
    }
    row.preferred = answers.preferred ?? null;
    row.keep_how = answers.keepHow ?? null;
    row.interview = answers.interview ?? null;
    return row;
  });
}

/** Their words, one record per person; only for `--text`. */
export function weekTexts(responses: WeekResponse[]): Record<string, unknown>[] {
  return responses.map(({ who, submittedAt, answers }) => ({
    participant: who,
    submitted: submittedAt !== null,
    ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, answers[field]?.trim() || null])),
  }));
}
