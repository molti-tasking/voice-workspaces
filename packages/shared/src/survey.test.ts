import { describe, expect, it } from "vitest";
import {
  SurveyResponseUpsert,
  WEEK_ITEMS,
  WEEK_ITEM_SCALES,
  WEEK_REVERSED,
  WEEK_SURVEY_VERSION,
  WeekAnswers,
  emptyAnswers,
  scoredRating,
  weekAnswered,
} from "./survey";

describe("the end-of-week questionnaire", () => {
  it("takes a document of ratings, choices and words, all optional", () => {
    expect(WeekAnswers.parse({})).toEqual({});
    const answers = {
      ratings: { choice_own: 6, choice_had_to: 2 },
      keptIncident: "The budget: I wanted to be the one who knew the number.",
      keepHow: "voice",
      preferred: "i_pick",
      interview: "yes",
    };
    expect(WeekAnswers.parse(answers)).toEqual(answers);
  });

  it("refuses a rating off the seven points, an item it does not know, and an unknown choice", () => {
    expect(WeekAnswers.safeParse({ ratings: { choice_own: 8 } }).success).toBe(false);
    expect(WeekAnswers.safeParse({ ratings: { choice_own: 0 } }).success).toBe(false);
    expect(WeekAnswers.safeParse({ ratings: { mood: 4 } }).success).toBe(false);
    expect(WeekAnswers.safeParse({ preferred: "both" }).success).toBe(false);
  });

  it("puts every item on a scale, and turns the reversed ones round", () => {
    expect(Object.keys(WEEK_ITEM_SCALES).sort()).toEqual([...WEEK_ITEMS].sort());
    for (const item of WEEK_REVERSED) expect(WEEK_ITEMS).toContain(item);
    expect(scoredRating("choice_had_to", 2)).toBe(6);
    expect(scoredRating("choice_own", 2)).toBe(2);
  });

  it("offers Send only once something is answered", () => {
    expect(weekAnswered(emptyAnswers("week"))).toBe(false);
    expect(weekAnswered({ ratings: {} })).toBe(false);
    expect(weekAnswered({ chooseFeel: "   " })).toBe(false);
    expect(weekAnswered({ ratings: { held_trust: 5 } })).toBe(true);
    expect(weekAnswered({ interview: "no" })).toBe(true);
  });
});

describe("saving either survey through one route", () => {
  it("checks the answers against their own survey's shape", () => {
    const week = { survey: "week", version: WEEK_SURVEY_VERSION, answers: { preferred: "i_pick" } };
    expect(SurveyResponseUpsert.safeParse(week).success).toBe(true);
    expect(SurveyResponseUpsert.safeParse({ ...week, answers: { ratings: { choice_own: 9 } } }).success).toBe(false);
    expect(
      SurveyResponseUpsert.safeParse({ survey: "initial", version: "initial-1", answers: { moments: "no" } }).success,
    ).toBe(false);
    expect(SurveyResponseUpsert.safeParse({ ...week, survey: "exit" }).success).toBe(false);
  });

  it("starts each survey from its own empty document", () => {
    expect(emptyAnswers("initial")).toEqual({ moments: [] });
    expect(emptyAnswers("week")).toEqual({});
  });
});
