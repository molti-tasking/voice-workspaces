import { describe, expect, it } from "vitest";
import { cleanCheckQuestion, comprehensionMessages, parseComprehension } from "./comprehension";

const EVIDENCE = { agentShare: 0.72, hesitation: "high" as const, settled: false, restated: false };

describe("comprehensionMessages", () => {
  it("gives the model the topic, the signals as evidence, and the lines", () => {
    const [system, user] = comprehensionMessages(
      "Lisbon trip",
      [
        { who: "agent", text: "The night train saves a hotel night." },
        { who: "user", text: "Okay, sounds good." },
      ],
      EVIDENCE,
    );
    expect(system?.content).toContain("never talk to the person");
    expect(user?.content).toContain('Topic: "Lisbon trip"');
    expect(user?.content).toContain("72% of the words were the assistant's");
    expect(user?.content).toContain("Hesitation, against their own usual: high");
    expect(user?.content).toContain("Person: Okay, sounds good.");
  });
});

describe("parseComprehension", () => {
  it("reads ideas and a check", () => {
    const raw = `Here you go: {"ideas": [
      {"text": "Night train saves a hotel night", "origin": "assistant", "hold": "borrowed", "why": "only said okay"},
      {"text": "Go in May", "origin": "you", "hold": "held", "why": "gave the festival as reason"}
    ], "check": {"kind": "explain", "question": "Why would the night train work out cheaper for you than flying?", "about": "Night train saves a hotel night"}}`;
    const parsed = parseComprehension(raw, 2);
    expect(parsed?.ordinal).toBe(2);
    expect(parsed?.ideas.map((i) => i.hold)).toEqual(["borrowed", "held"]);
    expect(parsed?.check?.kind).toBe("explain");
  });

  it("drops malformed ideas and a check that is not a question", () => {
    const raw = `{"ideas": [{"text": "x", "origin": "robot", "hold": "held"}], "check": {"kind": "explain", "question": "Explain it."}}`;
    expect(parseComprehension(raw, 1)).toEqual({ ordinal: 1, ideas: [], check: null });
  });

  it("accepts null when everything is held", () => {
    expect(parseComprehension(`{"ideas": [], "check": null}`, 3)).toEqual({ ordinal: 3, ideas: [], check: null });
  });

  it("is null for an answer that is not JSON", () => {
    expect(parseComprehension("I think they understood.", 1)).toBeNull();
  });
});

describe("cleanCheckQuestion", () => {
  it("strips quotes and refuses long or non-questions", () => {
    expect(cleanCheckQuestion('"What could make the train fail?"')).toBe("What could make the train fail?");
    expect(cleanCheckQuestion("Tell me more.")).toBeNull();
    expect(cleanCheckQuestion(`${"word ".repeat(30)}?`)).toBeNull();
  });
});
