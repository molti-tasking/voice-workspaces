import { describe, expect, it } from "vitest";
import {
  BLIND_DESCRIPTIONS,
  RESUMPTION_PROMPT,
  SUMMARY_PROMPT,
  blindCheck,
  blindMessages,
  parseBlindGuess,
  parseResumptionJudgement,
  parseSummaryJudgement,
  renderLines,
  resumptionMessages,
  scrubViewWords,
  summaryMessages,
} from "./study-judge";

describe("what the judge reads", () => {
  it("has the words that would name a view scrubbed", () => {
    expect(scrubViewWords("The bubbles helped, and the transcript too.")).toBe("The […] helped, and the […] too.");
    expect(scrubViewWords("I tapped a spark on the screen, word for word")).toBe("I tapped a […] […], […]");
    expect(scrubViewWords("Aarhus by train, two nights")).toBe("Aarhus by train, two nights");
  });

  it("labels the two sides neutrally, numbered when it must point at a line", () => {
    const lines = [
      { who: "Person" as const, text: "Train or bus?" },
      { who: "Assistant" as const, text: "The train." },
    ];
    expect(renderLines(lines)).toBe("Person: Train or bus?\nAssistant: The train.");
    expect(renderLines(lines, { numbered: true })).toBe("[1] Person: Train or bus?\n[2] Assistant: The train.");
    expect(renderLines([])).toBe("(nothing was said)");
  });

  it("never names a view in the scoring rubrics", () => {
    for (const prompt of [SUMMARY_PROMPT, RESUMPTION_PROMPT]) {
      expect(prompt).not.toMatch(/transcript view|bubble|circle|headline|mirror|spark|timeline|screen|phone showed/i);
    }
    expect(RESUMPTION_PROMPT).not.toMatch(/note|probe_accuracy/i);
    // Only the blind check describes them, which is the point of it: the setup's, with nothing to tap.
    for (const description of Object.values(BLIND_DESCRIPTIONS)) expect(description).not.toMatch(/tap/);
  });

  it("asks session-2's blind check word for word as its scores were made", () => {
    expect(blindCheck(["chat", "topics", "uptake"])).toEqual({
      options: { A: "chat", B: "topics", C: "uptake" },
      prompt: `A person had this conversation with a voice assistant while their phone showed it in one of three ways:
A — every line, word for word, like a chat.
B — only the topics, one under the other in the order they came up, with a few short points for each.
C — the same topics, each with the assistant's ideas on it marked as taken up by the person or not yet.

From the conversation alone, which do you think it was? If nothing in it tells you, guess.

Reply with ONLY a JSON object of this shape, nothing else:
{"guess": "A" | "B" | "C", "confidence": 1-5}`,
    });
  });

  it("letters any setup's views in its order, and needs two to tell apart", () => {
    const check = blindCheck(["stack", "chat", "uptake", "recent"]);
    expect(check.options).toEqual({ A: "stack", B: "chat", C: "uptake", D: "recent" });
    expect(check.prompt).toContain("in one of four ways:\nA — the topics as a stack");
    // Without the topic line before it, uptake is described on its own.
    expect(check.prompt).toContain(`C — ${BLIND_DESCRIPTIONS.uptake}`);
    expect(check.prompt).toContain('{"guess": "A" | "B" | "C" | "D"');
    expect(() => blindCheck(["chat"])).toThrow(/two views/);
  });

  it("puts the conversation and their words in the user turn, the rubric in the system turn", () => {
    const lines = [{ who: "Person" as const, text: "Train." }];
    const summary = summaryMessages({ lines, summary: "We took the train." });
    expect(summary[0]).toEqual({ role: "system", content: SUMMARY_PROMPT });
    expect(summary[1]!.content).toContain("=== THEIR SUMMARY ===\nWe took the train.");
    const resumption = resumptionMessages({ before: lines, after: lines });
    expect(resumption[1]!.content).not.toContain("THEIR NOTE");
    expect(resumption[1]!.content).toContain("=== AFTER ===\n[1] Person: Train.");
    const check = blindCheck(["chat", "stack"]);
    expect(blindMessages({ lines, check })[0]!.content).toBe(check.prompt);
  });
});

describe("reading the judge's answers", () => {
  it("reads a summary judgement, fenced or not, dropping points it could not classify", () => {
    const raw =
      '```json\n{"key_points": [{"point": "Train to Aarhus", "in_summary": "present"}, {"point": "Two nights", "in_summary": "Partial"}, {"point": "Hostel", "in_summary": "maybe"}, {"point": "Budget 300", "in_summary": "absent"}], "invented": 1, "coverage": "4", "accuracy": 5, "specificity": 3, "reason": "Close."}\n```';
    expect(parseSummaryJudgement(raw)).toMatchObject({
      present: 1,
      partial: 1,
      absent: 1,
      coverageShare: 0.5,
      invented: 1,
      coverage: 4,
      accuracy: 5,
      specificity: 3,
      reason: "Close.",
    });
    expect(parseSummaryJudgement('{"coverage": 2, "accuracy": 2, "specificity": 2}')).toMatchObject({
      keyPoints: [],
      coverageShare: null,
      invented: 0,
    });
  });

  it("refuses a summary score off the scale, or no JSON at all", () => {
    expect(() => parseSummaryJudgement('{"coverage": 6, "accuracy": 2, "specificity": 2}')).toThrow(/coverage/);
    expect(() => parseSummaryJudgement('{"coverage": 3, "accuracy": 2, "specificity": 2, "invented": -1}')).toThrow(/invented/);
    expect(() => parseSummaryJudgement("I think it was fine.")).toThrow(/no JSON/);
  });

  it("reads a resumption judgement, and ignores a line it was never shown", () => {
    const raw = '{"resumed_same_topic": "Yes", "first_on_topic_line": 2, "asked_assistant": false, "reason": "Back on trains."}';
    expect(parseResumptionJudgement(raw, 5)).toEqual({
      resumedSameTopic: "yes",
      firstOnTopicLine: 2,
      askedAssistant: false,
      reason: "Back on trains.",
    });
    const odd = '{"resumed_same_topic": "kind of", "first_on_topic_line": 9, "asked_assistant": "true"}';
    expect(parseResumptionJudgement(odd, 5)).toMatchObject({
      resumedSameTopic: "unclear",
      firstOnTopicLine: null,
      askedAssistant: true,
    });
    expect(parseResumptionJudgement('{"first_on_topic_line": null}', 3).firstOnTopicLine).toBeNull();
  });

  it("reads the blind guess as one of the three letters", () => {
    expect(parseBlindGuess('{"guess": "c", "confidence": 2}', ["A", "B", "C"])).toEqual({ guess: "C", confidence: 2 });
    expect(() => parseBlindGuess('{"guess": "D", "confidence": 2}', ["A", "B", "C"])).toThrow(/not an option/);
  });
});
