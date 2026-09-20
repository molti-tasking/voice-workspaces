import { describe, expect, it } from "vitest";
import { STT_LANGUAGES } from "./language";
import { SUMMARY_PROMPT, summaryPromptFor } from "./summary";

/**
 * The running summary's instruction.
 *
 * `foldSummary` makes a model call and is not tested here; what is testable,
 * and what went wrong, is which language the summary comes back in. On the
 * first formative pilot (19 Sep 2026) the drive was German and the running
 * summary handed to the model was English — and the summary sits closest to
 * the driver's words in every turn's context, so it is pressure on every reply
 * to leave the conversation's own language.
 */
describe("summaryPromptFor", () => {
  it("keeps the base prompt intact and adds one line", () => {
    const german = summaryPromptFor("de");
    expect(german.startsWith(SUMMARY_PROMPT)).toBe(true);
    expect(german.slice(SUMMARY_PROMPT.length).trim().split("\n")).toHaveLength(1);
  });

  it("names the language the way the person chose it", () => {
    // Endonyms, from the recorder's own picker: it is the word they saw, and
    // "write in Deutsch" is a clearer instruction to a model than "in German".
    for (const { code, label } of STT_LANGUAGES) {
      expect(summaryPromptFor(code)).toContain(label);
    }
  });

  it("changes nothing on auto-detect, or for a code the catalogue dropped", () => {
    // Which is exactly what those drives ran under, so they stay comparable.
    expect(summaryPromptFor(null)).toBe(SUMMARY_PROMPT);
    expect(summaryPromptFor(undefined)).toBe(SUMMARY_PROMPT);
    expect(summaryPromptFor("kl")).toBe(SUMMARY_PROMPT);
  });
});
