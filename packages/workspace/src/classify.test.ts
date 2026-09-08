import { describe, expect, it } from "vitest";
import {
  buildClassifyPrompt,
  parseClassificationResponse,
  type ClassifyCandidate,
} from "./classify";

const candidates: ClassifyCandidate[] = [
  { id: "u1", text: "Mark that." },
  { id: "u2", text: "I should remember to email him." },
];

describe("buildClassifyPrompt", () => {
  it("offers the user's capabilities as vocabulary", () => {
    const [system] = buildClassifyPrompt(candidates, ["mark", "diary"]);
    expect(system?.content).toContain("Existing capabilities: mark, diary.");
  });

  it("forbids naming one when the repertoire is empty", () => {
    const [system] = buildClassifyPrompt(candidates, []);
    expect(system?.content).toContain("never name one");
  });

  it("labels each line with its id so verdicts can be matched back", () => {
    const [, user] = buildClassifyPrompt(candidates, []);
    expect(user?.content).toBe("[u1] Mark that.\n[u2] I should remember to email him.");
  });
});

describe("parseClassificationResponse", () => {
  it("reads a well-formed response", () => {
    const raw = JSON.stringify({
      lines: [
        {
          id: "u1",
          kind: "directive",
          confidence: 88,
          verb: "Mark",
          object: "that",
          restatement: "Marking that.",
          capability: "mark",
        },
        { id: "u2", kind: "content", confidence: 95 },
      ],
    });
    const { classifications, warnings } = parseClassificationResponse(raw, candidates, ["mark"]);
    expect(warnings).toEqual([]);
    expect(classifications[0]).toMatchObject({
      id: "u1",
      kind: "directive",
      verb: "mark",
      capabilityName: "mark",
    });
    expect(classifications[1]).toMatchObject({ id: "u2", kind: "content", confidence: 95 });
  });

  it("survives a fenced response", () => {
    const raw = '```json\n{"lines":[{"id":"u1","kind":"content","confidence":70}]}\n```';
    expect(parseClassificationResponse(raw, candidates).classifications[0]?.kind).toBe("content");
  });

  it("returns nothing rather than throwing on unparseable output", () => {
    const { classifications, warnings } = parseClassificationResponse("not json", candidates);
    expect(classifications).toEqual([]);
    expect(warnings).toEqual(["response was not JSON"]);
  });

  it("drops verdicts for ids it was never given", () => {
    const raw = JSON.stringify({ lines: [{ id: "u9", kind: "directive", verb: "mark" }] });
    const { classifications, warnings } = parseClassificationResponse(raw, candidates);
    expect(classifications).toEqual([]);
    expect(warnings).toContain('unknown id "u9"');
  });

  /**
   * A capability the model made up would be written to `directive.capabilityId`
   * as a name that resolves to nothing, and the row would then read as
   * "resolved" while pointing nowhere — invisible to the macro detector, which
   * mines exactly the unresolved rows.
   */
  it("refuses a capability name outside the offered vocabulary", () => {
    const raw = JSON.stringify({
      lines: [{ id: "u1", kind: "directive", confidence: 80, verb: "mark", capability: "invented" }],
    });
    const { classifications, warnings } = parseClassificationResponse(raw, candidates, ["mark"]);
    expect(classifications[0]?.capabilityName).toBeUndefined();
    expect(warnings.join(" ")).toContain("invented");
  });

  it("demotes a directive with no usable verb to content", () => {
    const raw = JSON.stringify({ lines: [{ id: "u1", kind: "directive", confidence: 60 }] });
    const { classifications, warnings } = parseClassificationResponse(raw, candidates);
    expect(classifications[0]).toMatchObject({ id: "u1", kind: "content" });
    expect(warnings.join(" ")).toContain("no usable verb");
  });

  it("clamps a confidence outside the range and defaults a missing one", () => {
    const raw = JSON.stringify({
      lines: [
        { id: "u1", kind: "content", confidence: 500 },
        { id: "u2", kind: "content" },
      ],
    });
    const { classifications } = parseClassificationResponse(raw, candidates);
    expect(classifications[0]?.confidence).toBe(100);
    expect(classifications[1]?.confidence).toBe(50);
  });

  it("warns about a candidate the model ignored", () => {
    const raw = JSON.stringify({ lines: [{ id: "u1", kind: "content", confidence: 90 }] });
    expect(parseClassificationResponse(raw, candidates).warnings).toContain("no verdict for u2");
  });

  it("falls back to a restatement built from the verb", () => {
    const raw = JSON.stringify({
      lines: [{ id: "u1", kind: "directive", confidence: 80, verb: "mark", object: "the funding" }],
    });
    const { classifications } = parseClassificationResponse(raw, candidates);
    expect(classifications[0]?.restatement).toBe("mark the funding");
  });
});
