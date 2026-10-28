import { describe, expect, it } from "vitest";
import { DIGEST_GIST_LINES, DIGEST_MAX_CHARS, digestMessages, gistSeqs, parseDigest } from "./digest";

describe("the conversation digest", () => {
  it("names the topics by number and marks each line with its topic", () => {
    const messages = digestMessages(
      [
        { ordinal: 1, title: "Weekend" },
        { ordinal: 2, title: "Destinations" },
      ],
      [
        { who: "user", text: "A long weekend, not too expensive.", ordinal: 1 },
        { who: "agent", text: "Aarhus, Skagen or Copenhagen.", ordinal: 2 },
        { who: "user", text: "Hello?", ordinal: null },
      ],
    );
    expect(messages[0]?.role).toBe("system");
    const content = messages[1]?.content ?? "";
    expect(content).toContain("1. Weekend\n2. Destinations");
    expect(content).toContain("[1] Person: A long weekend");
    expect(content).toContain("[2] Assistant: Aarhus, Skagen");
    expect(content).toContain("[-] Person: Hello?");
  });

  it("sends only the last lines of a long conversation", () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({ who: "user" as const, text: `line ${i}`, ordinal: 1 }));
    const content = digestMessages([{ ordinal: 1, title: "Long" }], lines)[1]?.content ?? "";
    expect(content).not.toContain("line 0\n");
    expect(content).toContain("line 119");
  });

  it("reads the JSON, fenced or bare", () => {
    const raw =
      '```json\n{"now": "Choosing between Aarhus and Skagen.", "topics": [{"n": 2, "you": ["City and sea"], "ai": ["Aarhus: ARoS"], "ideas": [{"text": "Aarhus for two nights", "takenUp": true}, {"text": "Skagen in autumn", "takenUp": false}]}], "open": [{"q": "Where to go?", "settled": true, "n": 2}, {"q": "How to get there?", "settled": false, "n": 3}]}\n```';
    expect(parseDigest(raw, [1, 2, 3])).toEqual({
      now: "Choosing between Aarhus and Skagen.",
      gists: [],
      topics: [
        {
          ordinal: 2,
          you: ["City and sea"],
          ai: ["Aarhus: ARoS"],
          ideas: [
            { text: "Aarhus for two nights", takenUp: true },
            { text: "Skagen in autumn", takenUp: false },
          ],
          decision: null,
        },
      ],
      open: [
        { text: "Where to go?", settled: true, ordinal: 2 },
        { text: "How to get there?", settled: false, ordinal: 3 },
      ],
    });
  });

  it("drops topics it was not given, and a question's unknown topic", () => {
    const digest = parseDigest(
      '{"topics": [{"n": 9, "you": ["x"]}, {"n": 1, "you": ["y"]}, {"n": 1, "you": ["again"]}], "open": [{"q": "When?", "n": 9}]}',
      [1],
    );
    expect(digest?.topics.map((t) => t.ordinal)).toEqual([1]);
    expect(digest?.topics[0]?.you).toEqual(["y"]);
    expect(digest?.open).toEqual([{ text: "When?", settled: false, ordinal: null }]);
  });

  it("counts an idea as taken up only when it says so", () => {
    const digest = parseDigest('{"topics": [{"n": 1, "ideas": ["Bare string", {"text": "Maybe", "takenUp": "yes"}]}]}', [1]);
    expect(digest?.topics[0]?.ideas).toEqual([
      { text: "Bare string", takenUp: false },
      { text: "Maybe", takenUp: false },
    ]);
  });

  it("tidies points: no list marks, no full stops, three at most, the newest kept", () => {
    const digest = parseDigest('{"topics": [{"n": 1, "you": ["- one.", "• two", "3. three", "four."]}]}', [1]);
    expect(digest?.topics[0]?.you).toEqual(["two", "three", "four"]);
  });

  it("cuts a point that runs long at a word", () => {
    const long = "word ".repeat(40).trim();
    const text = parseDigest(`{"topics": [{"n": 1, "ai": ["${long}"]}]}`, [1])?.topics[0]?.ai[0] ?? "";
    expect(text.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS + 1);
    expect(text.endsWith("…")).toBe(true);
  });

  it("is null for anything that is not the object asked for", () => {
    expect(parseDigest("Sorry, I can't.", [1])).toBeNull();
    expect(parseDigest("{not json}", [1])).toBeNull();
    expect(parseDigest('{"other": 1}', [1])).toBeNull();
  });

  it("asks a gist only of the newest lines, each marked by its seq", () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ who: "user" as const, text: `line ${i}`, ordinal: 1, seq: i }));
    expect(gistSeqs(lines)).toEqual([4, 5, 6, 7, 8, 9].slice(-DIGEST_GIST_LINES));
    const content = digestMessages([{ ordinal: 1, title: "Long" }], lines)[1]?.content ?? "";
    expect(content).toContain("[1] #9 Person: line 9");
    expect(content).toContain("[1] Person: line 3");
  });

  it("keeps a gist only for a turn it asked about, in two words and one", () => {
    const raw =
      '{"now": null, "topics": [], "open": [], "gists": [{"id": 8, "two": "train slower, cheaper.", "one": "train"}, {"id": 99, "two": "made up", "one": "up"}, {"id": 9, "two": "Aarhus"}]}';
    expect(parseDigest(raw, [], [8, 9])?.gists).toEqual([
      { seq: 8, two: "train slower, cheaper", one: "train" },
      { seq: 9, two: "Aarhus", one: "Aarhus" },
    ]);
  });

  it("keeps a topic's decision short, and null when nothing is decided", () => {
    const raw =
      '{"topics": [{"n": 1, "decision": "Sat 9:12 ICE, seats reserved."}, {"n": 2, "decision": null}, {"n": 3, "decision": "  "}]}';
    expect(parseDigest(raw, [1, 2, 3])?.topics.map((t) => t.decision)).toEqual([
      "Sat 9:12 ICE, seats reserved",
      null,
      null,
    ]);
  });

  it("keeps a turn's line beside its two words, when the model wrote one", () => {
    const raw =
      '{"now": null, "topics": [], "open": [], "gists": [{"id": 4, "line": "Fish place by the harbour, bookings until six.", "two": "fish place", "one": "fish"}, {"id": 5, "two": "breakfast", "one": "breakfast"}]}';
    expect(parseDigest(raw, [], [4, 5])?.gists).toEqual([
      { seq: 4, line: "Fish place by the harbour, bookings until six", two: "fish place", one: "fish" },
      { seq: 5, two: "breakfast", one: "breakfast" },
    ]);
  });
});
