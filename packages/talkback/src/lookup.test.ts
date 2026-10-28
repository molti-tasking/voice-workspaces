import { describe, expect, it } from "vitest";
import { LOOKUP_SECTION, LOOKUP_TOOL, lookupFoundLabel, lookupQuery, parseMockSearch, withLookup } from "./lookup";
import { REALTIME_FIELD_PROMPT, REALTIME_SESSION_PROMPT, composeRealtimeFieldPrompt, realtimeSessionConfig } from "./realtime";

describe("looking things up", () => {
  it("rewrites both agents' 'cannot look anything up'", () => {
    expect(withLookup(REALTIME_FIELD_PROMPT)).not.toContain("look anything up");
    expect(withLookup(REALTIME_SESSION_PROMPT)).not.toContain("You cannot look anything up");
  });

  it("refuses a prompt with nothing to rewrite", () => {
    expect(() => withLookup("Just talk.")).toThrow();
  });

  it("adds the section only when the lookup is on", () => {
    expect(composeRealtimeFieldPrompt({ lookup: true }).prompt).toContain(LOOKUP_SECTION);
    expect(composeRealtimeFieldPrompt({}).prompt).not.toContain(LOOKUP_SECTION);
  });

  it("offers the tool only when asked to", () => {
    const base = { model: "m", instructions: "i", voice: "marin", language: null, transcribeModel: "t", eagerness: "auto" as const };
    expect(realtimeSessionConfig(base).tools).toBeUndefined();
    expect(realtimeSessionConfig({ ...base, tools: [LOOKUP_TOOL] })).toMatchObject({ tools: [LOOKUP_TOOL], tool_choice: "auto" });
  });

  it("reads the query from the provider's argument string", () => {
    expect(lookupQuery('{"query": "  fish   restaurant Hamburg "}')).toBe("fish restaurant Hamburg");
    expect(lookupQuery({ query: "Aarhus weather" })).toBe("Aarhus weather");
    expect(lookupQuery("not json")).toBeNull();
    expect(lookupQuery('{"q": "x"}')).toBeNull();
  });

  it("keeps the mock's results that have a title and a snippet", () => {
    const raw = 'Here: {"results": [{"title": "Fischhaus", "snippet": "Open 12–22"}, {"title": "No snippet"}, {"snippet": "no title"}]}';
    expect(parseMockSearch(raw)).toEqual([{ title: "Fischhaus", snippet: "Open 12–22" }]);
    expect(parseMockSearch("no json")).toBeNull();
  });

  it("says what came back in a few words", () => {
    expect(lookupFoundLabel(0)).toBe("Nothing found");
    expect(lookupFoundLabel(1)).toBe("1 result found");
    expect(lookupFoundLabel(3)).toBe("3 results found");
  });
});
