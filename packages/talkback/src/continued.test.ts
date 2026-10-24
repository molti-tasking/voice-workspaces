import { describe, expect, it } from "vitest";
import { CONTINUED_MAX_CHARS, renderContinued } from "./continued";

describe("a continued conversation, as the agent is told it", () => {
  it("says it is being picked up, with its topics and lines, from the agent's side", () => {
    const text = renderContinued({
      topics: ["Weekend", "Destinations"],
      lines: [
        { who: "user", text: "A weekend in Denmark." },
        { who: "agent", text: "Aarhus or Skagen?" },
      ],
      when: "yesterday, 18:40",
    })!;
    expect(text).toMatch(/CONTINUES AN EARLIER CONVERSATION \(last talked about yesterday, 18:40\)/);
    expect(text).toMatch(/do not start over/);
    expect(text).toContain("Its topics, in order: Weekend; Destinations.");
    expect(text).toContain("They: A weekend in Denmark.\nYou: Aarhus or Skagen?");
  });

  it("keeps the newest lines when there are too many, and says so", () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ who: "user" as const, text: `line ${i} ${"x".repeat(40)}` }));
    const text = renderContinued({ topics: [], lines, when: null })!;
    expect(text).toContain("line 199");
    expect(text).not.toContain("line 0 ");
    expect(text).toMatch(/earlier ones left out/);
    expect(text.length).toBeLessThan(CONTINUED_MAX_CHARS + 600);
  });

  it("is nothing for a conversation with nothing said", () => {
    expect(renderContinued({ topics: ["x"], lines: [], when: null })).toBeNull();
  });
});
