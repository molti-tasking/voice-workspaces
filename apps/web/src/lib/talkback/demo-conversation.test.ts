import { describe, expect, it } from "vitest";
import { EMPTY_CONVERSATION, applyMessage, timeline } from "./conversation";
import { DEMO_POINTS, DEMO_STEPS, demoSparkQuestion } from "./demo-conversation";
import { sparksFor } from "./signals";

describe("the simulated conversation", () => {
  // Played back at the pace it is scripted at, as the demo plays it.
  let at = 0;
  const final = DEMO_STEPS.reduce((state, step) => {
    at += step.waitMs;
    return applyMessage(state, step.message, at);
  }, EMPTY_CONVERSATION);

  it("names seven topics and comes back to two of them", () => {
    expect(final.sections.map((s) => s.title)).toEqual([
      "Weekend in Denmark",
      "Destinations",
      "Getting there",
      "Paper deadline",
      "Budget",
      "Things to do in Aarhus",
      "Weather",
    ]);
    expect(timeline(final).filter((run) => run.isReturn).map((run) => run.title)).toEqual([
      "Destinations",
      "Weekend in Denmark",
    ]);
  });

  it("ends with sparks on offer, so the views have something to show", () => {
    const kinds = sparksFor(final, at).map((spark) => `${spark.kind}:${spark.title}`);
    expect(kinds).toEqual(
      expect.arrayContaining(["decide:Getting there", "say_back:Destinations", "say_back:Things to do in Aarhus"]),
    );
  });

  it("has the mirror's points for every topic it names", () => {
    for (const section of final.sections) expect(DEMO_POINTS.has(section.title!)).toBe(true);
    expect(demoSparkQuestion("decide", "Getting there")).toMatch(/\?$/);
  });
});
