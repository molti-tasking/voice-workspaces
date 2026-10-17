import { describe, expect, it } from "vitest";
import { SPARK_QUESTION_MAX_CHARS, cleanSparkQuestion, sparkQuestionMessages } from "./spark-question";

describe("a spark's own question", () => {
  it("asks the model about this topic and these lines, newest last", () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ who: i % 2 ? "agent" : "user", text: `line ${i}` }) as const);
    const [system, user] = sparkQuestionMessages("decide", "Cooling centres", lines);
    expect(system!.content).toMatch(/at most 18 words/i);
    expect(user!.content).toContain('Topic: "Cooling centres"');
    expect(user!.content).toContain("line 19");
    expect(user!.content).not.toContain("line 5\n");
    expect(user!.content).toMatch(/choose between/);
  });

  it("keeps a clean question and refuses anything else", () => {
    expect(cleanSparkQuestion('"Why would the library beat the gym as a cooling centre?"')).toBe(
      "Why would the library beat the gym as a cooling centre?",
    );
    expect(cleanSparkQuestion("\n  Trees or reflective roofs first?\nExtra line")).toBe("Trees or reflective roofs first?");
    expect(cleanSparkQuestion("Here is a question for you.")).toBeNull();
    expect(cleanSparkQuestion("Why?")).toBeNull();
    expect(cleanSparkQuestion(`${"x".repeat(SPARK_QUESTION_MAX_CHARS)}?`)).toBeNull();
    expect(cleanSparkQuestion("")).toBeNull();
  });
});
