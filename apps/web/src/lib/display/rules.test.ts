import { describe, expect, it } from "vitest";
import { settle, toGlance } from "./rules";

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
