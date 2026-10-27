import { describe, expect, it } from "vitest";
import { EMPTY_CONVERSATION, applyMessage, timeline } from "./conversation";
import { atCursor } from "./cursor";
import { DEMO_STEPS, demoDigest, demoSparkQuestion, demoTopicTitles } from "./demo-conversation";
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

  it("has a digest for every topic it names", () => {
    for (const section of final.sections) expect(demoTopicTitles()).toContain(section.title);
    expect(demoDigest(final).topics).toHaveLength(final.sections.length);
    expect(demoSparkQuestion("decide", "Getting there")).toMatch(/\?$/);
  });

  it("has every turn in two words and in one, for the Recent view", () => {
    const turns = final.sections.flatMap((s) => s.turns);
    expect(demoDigest(final).gists?.map((g) => g.seq).sort((x, y) => x - y)).toEqual(
      turns.map((t) => t.seq).sort((x, y) => x - y),
    );
  });

  it("digests the conversation as it stood, not as it ended", () => {
    const end = demoDigest(final);
    expect(end.now).toMatch(/only the journey is open/);
    expect(end.open.filter((q) => !q.settled).map((q) => q.text)).toEqual(["How to get there?", "What to do there?"]);
    // Back when the destinations had just been offered: nothing settled, nothing taken up.
    const offered = final.sections.find((s) => s.title === "Destinations")!.turns[1]!.seq;
    const then = demoDigest(atCursor(final, offered));
    expect(then.now).toMatch(/Choosing where to go/);
    expect(then.topics.flatMap((t) => t.ideas).some((i) => i.takenUp)).toBe(false);
    expect(then.open.map((q) => q.text)).toEqual(["Where to go?"]);
  });
});
