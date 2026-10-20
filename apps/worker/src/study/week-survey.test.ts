import { describe, expect, it } from "vitest";
import { weekRows, weekTexts, type WeekResponse } from "./week-survey";

const SENT = new Date("2026-10-26T18:00:00Z");

const responses: WeekResponse[] = [
  {
    who: "P03",
    version: "week-1",
    submittedAt: SENT,
    answers: {
      // choice: 6 as given, and 2 reversed to 6; load: 3 reversed to 5.
      ratings: { choice_own: 6, choice_had_to: 2, choice_effort: 3, sparks_chosen_useful: 5 },
      preferred: "i_pick",
      keepHow: "voice",
      interview: "yes",
      keptIncident: "  The budget, because I wanted to know the number myself.  ",
      change: "",
    },
  },
  { who: "user-without-pseudonym", version: "week-1", submittedAt: null, answers: {} },
];

describe("the end-of-week export", () => {
  it("gives the closed answers per person, with each scale scored the right way round", () => {
    const [p03, draft] = weekRows(responses);
    expect(p03).toMatchObject({
      participant: "P03",
      submitted: true,
      submitted_on: "2026-10-26",
      choice_own: 6,
      choice_had_to: 2,
      held_trust: null,
      scale_choice: 6,
      scale_load: 5,
      scale_sparks: 5,
      scale_trust: null,
      preferred: "i_pick",
      keep_how: "voice",
      interview: "yes",
    });
    expect(draft).toMatchObject({ participant: "user-without-pseudonym", submitted: false, scale_choice: null });
  });

  it("keeps their words out of the rows, and gives them only from weekTexts", () => {
    expect(JSON.stringify(weekRows(responses))).not.toContain("budget");
    const [p03] = weekTexts(responses);
    expect(p03).toMatchObject({
      participant: "P03",
      keptIncident: "The budget, because I wanted to know the number myself.",
      // Blank is no answer, not an empty one.
      change: null,
      heldIncident: null,
    });
  });
});
