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

  it("names four topics and comes back to one of them", () => {
    expect(final.sections.map((s) => s.title)).toEqual([
      "Weekend in Denmark",
      "Destinations",
      "Getting there",
      "Paper deadline",
    ]);
    expect(timeline(final).filter((run) => run.isReturn)).toHaveLength(1);
  });

  it("ends with sparks on offer, so the views have something to show", () => {
    const kinds = sparksFor(final, at).map((spark) => `${spark.kind}:${spark.title}`);
    expect(kinds).toContain("say_back:Destinations");
    expect(kinds).toContain("decide:Getting there");
  });

  it("has the mirror's points for every topic it names", () => {
    for (const section of final.sections) expect(DEMO_POINTS.has(section.title!)).toBe(true);
    expect(demoSparkQuestion("decide", "Getting there")).toMatch(/\?$/);
  });
});
