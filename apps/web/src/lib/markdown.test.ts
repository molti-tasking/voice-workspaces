import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("reads the draft from 7 Oct 2026 as a heading-like line and a list, with no asterisks left", () => {
    const blocks = parseMarkdown(
      [
        "**Identified Weaknesses**",
        "- **Search Tool Reliability:** Failed on basic queries (e.g., \"a cat\").",
        "- **Over-reliance on Tool Reports**",
      ].join("\n"),
    );

    expect(blocks).toEqual([
      { kind: "paragraph", lines: [[{ kind: "strong", text: "Identified Weaknesses" }]] },
      {
        kind: "list",
        ordered: false,
        items: [
          [
            { kind: "strong", text: "Search Tool Reliability:" },
            { kind: "text", text: ' Failed on basic queries (e.g., "a cat").' },
          ],
          [{ kind: "strong", text: "Over-reliance on Tool Reports" }],
        ],
      },
    ]);
  });

  it("keeps an email's line breaks and splits paragraphs on blank lines", () => {
    const blocks = parseMarkdown("Hi William,\nthe pilot starts Monday.\n\nBest,\nAnna");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      lines: [[{ kind: "text", text: "Hi William," }], [{ kind: "text", text: "the pilot starts Monday." }]],
    });
  });

  it("knows headings and numbered lists, and starts a new list when the kind changes", () => {
    const blocks = parseMarkdown("## Plan\n1. Draft\n2) Send\n- aside");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "list", "list"]);
    expect(blocks[0]).toMatchObject({ level: 2, inline: [{ kind: "text", text: "Plan" }] });
    expect(blocks[1]).toMatchObject({ ordered: true });
    expect(blocks[2]).toMatchObject({ ordered: false });
  });

  it("folds an unmarked line under a list item into that item", () => {
    const [list] = parseMarkdown("- first point\n  that wraps\n- second");
    expect(list).toMatchObject({ kind: "list" });
    expect((list as { items: unknown[] }).items).toHaveLength(2);
  });
});

describe("parseInline", () => {
  it("reads bold, italic and code", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      { kind: "text", text: "a " },
      { kind: "strong", text: "b" },
      { kind: "text", text: " " },
      { kind: "em", text: "c" },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
    ]);
  });

  it("leaves underscores and lone asterisks alone", () => {
    expect(parseInline("snake_case_name and 2 * 3 * 4")).toEqual([
      { kind: "text", text: "snake_case_name and 2 * 3 * 4" },
    ]);
  });

  it("links only to http, https and mailto", () => {
    expect(parseInline("[CHI](https://chi.acm.org)")).toEqual([
      { kind: "link", text: "CHI", href: "https://chi.acm.org" },
    ]);
    expect(parseInline("[x](javascript:alert(1))")[0]).toMatchObject({ kind: "text" });
  });
});
