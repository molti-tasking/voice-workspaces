import { describe, expect, it } from "vitest";
import type { FindingsAnswers } from "@voicemural/shared";
import { median, summarise, umuxLite, type FindingsResponse } from "./summary";

let n = 0;
function response(answers: FindingsAnswers): FindingsResponse {
  n += 1;
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, submittedOn: "2026-10-13", answers };
}

describe("median", () => {
  it("is null for nothing, never zero", () => {
    expect(median([])).toBeNull();
  });

  it("takes the middle, or the mean of the two middles", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("umuxLite", () => {
  it("spans 0 to 100", () => {
    expect(umuxLite(1, 1)).toBe(0);
    expect(umuxLite(7, 7)).toBe(100);
    expect(umuxLite(4, 4)).toBe(50);
  });
});

describe("summarise", () => {
  it("counts who answered each question, not who sent the form", () => {
    const s = summarise([
      response({ usage: "regularly", arrival: "forgot_it_was_on" }),
      response({ usage: "once_or_twice" }),
      response({ neverDo: "Decide for me." }),
    ]);
    expect(s.respondents).toBe(3);
    expect(s.usage.answered).toBe(2);
    expect(s.arrival.answered).toBe(1);
    expect(s.arrival.tallies.find((t) => t.key === "forgot_it_was_on")?.count).toBe(1);
  });

  it("keeps tallies in the form's option order, zeros included", () => {
    const s = summarise([response({ keepUsing: "no" })]);
    expect(s.keepUsing.tallies.map((t) => t.key)).toEqual(["regularly", "certain_drives", "no"]);
    expect(s.keepUsing.tallies.map((t) => t.count)).toEqual([0, 0, 1]);
  });

  it("keeps 'it didn't come up' out of the silence scale", () => {
    const s = summarise([
      response({ silenceMatch: 2 }),
      response({ silenceMatch: "na" }),
      response({ silenceMatch: 4 }),
    ]);
    expect(s.silence.values).toEqual([2, 4]);
    expect(s.silence.notApplicable).toBe(1);
    expect(s.silence.answered).toBe(3);
  });

  it("counts a reason once per respondent, and only respondents who ticked something", () => {
    const s = summarise([
      response({ useReasons: ["forgot", "forgot", "not_alone"] }),
      response({ useReasons: ["forgot"] }),
      response({ useReasons: [] }),
    ]);
    expect(s.useReasons.answered).toBe(2);
    expect(s.useReasons.tallies.find((t) => t.key === "forgot")?.count).toBe(2);
    expect(s.useReasons.tallies.find((t) => t.key === "not_alone")?.count).toBe(1);
  });

  it("sorts the hand-off rows from most handed over to most kept, unanswered last", () => {
    const s = summarise([
      response({ handOff: { remember_task: "gladly", what_matters: "myself", sum_up: "check_later" } }),
      response({ handOff: { remember_task: "gladly", what_matters: "myself", sum_up: "gladly" } }),
    ]);
    const order = s.handOff.map((row) => row.task);
    expect(order.slice(0, 3)).toEqual(["remember_task", "sum_up", "what_matters"]);
    expect(s.handOff[0]).toMatchObject({ answered: 2, net: 1, counts: { gladly: 2, check_later: 0, myself: 0 } });
    expect(s.handOff[2]).toMatchObject({ task: "what_matters", net: -1 });
    expect(s.handOff.slice(3).every((row) => row.answered === 0)).toBe(true);
  });

  it("scores UMUX-Lite only for respondents who answered both items", () => {
    const s = summarise([
      response({ umuxCapabilities: 7, umuxEase: 7 }),
      response({ umuxCapabilities: 1 }),
    ]);
    expect(s.umux.scores).toEqual([100]);
    expect(s.umux.capabilities).toEqual([7, 1]);
    expect(s.umux.ease).toEqual([7]);
  });

  it("lists written answers with ids that survive a refresh, and skips blank ones", () => {
    const first = response({ neverDo: "  Decide for me.  ", learned: "   " });
    const s = summarise([first]);
    expect(s.quotes.neverDo).toEqual([{ id: `${first.id}:neverDo`, field: "neverDo", text: "Decide for me." }]);
    expect(s.quotes.learned).toEqual([]);
    expect(summarise([first]).quotes.neverDo[0]?.id).toBe(s.quotes.neverDo[0]?.id);
  });
});
