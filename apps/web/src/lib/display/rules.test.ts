import { describe, expect, it } from "vitest";
import { DISPLAY_RULES, groupByTopic, settle, toGlance } from "./rules";

const item = (id: string, text = id) => ({ id, text });

describe("toGlance", () => {
  it("leaves a short line alone", () => {
    expect(toGlance("Mark the funding bit")).toBe("Mark the funding bit");
  });

  it("cuts on a word boundary, never mid-word", () => {
    const out = toGlance("one two three four five six seven eight nine ten", 4);
    expect(out).toBe("one two three four…");
  });

  it("collapses the whitespace a transcript brings with it", () => {
    expect(toGlance("  a   b  ")).toBe("a b");
  });
});

describe("settle", () => {
  it("keeps a visible item in the slot it already holds", () => {
    const visible = [item("c"), item("b"), item("a")];
    const incoming = [item("a"), item("b"), item("c")];
    expect(settle(visible, incoming, 3).map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("puts arrivals at the top and pushes the oldest off the bottom", () => {
    const visible = [item("b"), item("a")];
    const incoming = [item("a"), item("b"), item("c"), item("d")];
    expect(settle(visible, incoming, 3).map((i) => i.id)).toEqual(["d", "c", "b"]);
  });

  it("refreshes an item's content without moving it", () => {
    const visible = [item("b", "old"), item("a")];
    const incoming = [item("a"), item("b", "new")];
    const out = settle(visible, incoming, 2);
    expect(out.map((i) => i.id)).toEqual(["b", "a"]);
    expect(out[0]?.text).toBe("new");
  });

  it("drops an item that is no longer in the incoming set", () => {
    const visible = [item("b"), item("a")];
    expect(settle(visible, [item("a")], 3).map((i) => i.id)).toEqual(["a"]);
  });

  it("renders nothing at all when the setting allows no cues", () => {
    expect(settle([item("a")], [item("a"), item("b")], 0)).toEqual([]);
  });

  it("fills an empty panel newest first", () => {
    expect(settle([], [item("a"), item("b"), item("c")], 2).map((i) => i.id)).toEqual(["c", "b"]);
  });
});

describe("density", () => {
  /**
   * The mistake this catches: one set of at-110km/h numbers was applied to
   * every setting that has a screen, including a desk. Glance and read are
   * different situations and every number that separates them belongs here.
   */
  it("reads with more room and less waiting than it glances", () => {
    const { glance, read } = DISPLAY_RULES;
    expect(read.dwellMs).toBeLessThan(glance.dwellMs);
    expect(read.maxWords).toBeNull();
    expect(glance.maxWords).not.toBeNull();
    expect(read.groupByTopic).toBe(true);
    expect(glance.groupByTopic).toBe(false);
  });

  it("holds a reserved height at either density", () => {
    for (const rules of Object.values(DISPLAY_RULES)) {
      expect(rules.minRows).toBeGreaterThanOrEqual(5);
    }
  });

  it("leaves the text alone when a density asks for no cut", () => {
    const long = "one two three four five six seven eight nine ten eleven twelve";
    expect(toGlance(long, DISPLAY_RULES.read.maxWords)).toBe(long);
    expect(toGlance(long, DISPLAY_RULES.glance.maxWords)).toMatch(/…$/);
  });
});

describe("groupByTopic", () => {
  const cue = (id: string, topic?: string) => ({ id, topic });

  it("keeps topics in the order their first block appeared", () => {
    const grouped = groupByTopic([
      cue("a", "Repertoire"),
      cue("b", "Midas touch"),
      cue("c", "Repertoire"),
    ]);
    expect(grouped.map((g) => g.topic)).toEqual(["Repertoire", "Midas touch"]);
    expect(grouped[0]?.cues.map((c) => c.id)).toEqual(["a", "c"]);
  });

  /**
   * A topic gaining a block must not jump the list. The reader is half looking
   * at this panel; a group that moves costs them their place in it.
   */
  it("does not promote a topic that gains a block", () => {
    const before = groupByTopic([cue("a", "First"), cue("b", "Second")]);
    const after = groupByTopic([cue("a", "First"), cue("b", "Second"), cue("c", "Second")]);
    expect(after.map((g) => g.topic)).toEqual(before.map((g) => g.topic));
  });

  it("files a block with no topic rather than dropping it", () => {
    const grouped = groupByTopic([cue("a"), cue("b", "  ")]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.topic).toBe("Unfiled");
    expect(grouped[0]?.cues).toHaveLength(2);
  });
});
