import { describe, expect, it } from "vitest";
import { topicFilename, topicToMarkdown, workspaceToMarkdown } from "./markdown";
import type { Block, Topic } from "./types";

const T = new Date("2026-08-08T09:00:00Z");

const topic: Topic = {
  id: "topic-a",
  title: "Research stay abroad",
  slug: "research-stay-abroad",
  icon: "Plane",
  createdAt: T,
  lastTouchedAt: T,
};

function block(kind: Block["kind"], text: string, id = text.slice(0, 8)): Block {
  return { id, topicId: topic.id, kind, text, spans: [], occurredAt: T };
}

const blocks: Block[] = [
  block("claim", "Wants to build software as part of the PhD."),
  block("question", "Where to go for the stay?"),
  block("context", "Second year of the PhD."),
  block("meta", "This is the abstract."),
];

describe("topicToMarkdown", () => {
  it("leads with the title as an H1", () => {
    expect(topicToMarkdown(topic, blocks).startsWith("# Research stay abroad\n")).toBe(
      true,
    );
  });

  it("pulls open questions into a checklist ahead of everything else", () => {
    const md = topicToMarkdown(topic, blocks);
    expect(md).toContain("## Open questions");
    expect(md).toContain("- [ ] Where to go for the stay?");
    // The checklist must precede the prose, as it does on the card.
    expect(md.indexOf("## Open questions")).toBeLessThan(
      md.indexOf("Wants to build software"),
    );
  });

  it("maps kinds to structure that survives losing the styling", () => {
    const md = topicToMarkdown(topic, blocks);
    expect(md).toContain("> Second year of the PhD."); // context → blockquote
    expect(md).toContain("*This is the abstract.*"); // meta   → italic aside
    expect(md).toContain("\nWants to build software as part of the PhD.\n"); // claim → prose
  });

  it("omits the questions section entirely when there are none", () => {
    const md = topicToMarkdown(topic, [block("claim", "Only a claim.")]);
    expect(md).not.toContain("Open questions");
  });

  it("handles a topic with no blocks at all", () => {
    expect(topicToMarkdown(topic, [])).toBe("# Research stay abroad\n");
  });

  it("ends with exactly one newline — a file, not a fragment", () => {
    const md = topicToMarkdown(topic, blocks);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("is stable for stable input", () => {
    expect(topicToMarkdown(topic, blocks)).toBe(topicToMarkdown(topic, blocks));
  });

  it("can carry frontmatter for a notes folder", () => {
    const md = topicToMarkdown(topic, blocks, {
      includeFrontmatter: true,
      asOf: T,
    });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain('title: "Research stay abroad"');
    expect(md).toContain("as_of: 2026-08-08T09:00:00.000Z");
  });
});

describe("workspaceToMarkdown", () => {
  it("concatenates every topic", () => {
    const other: Topic = { ...topic, id: "topic-b", title: "CHI paper", slug: "chi-paper" };
    const md = workspaceToMarkdown(
      [topic, other],
      new Map([
        [topic.id, blocks],
        [other.id, [block("claim", "The contribution is the repertoire.")]],
      ]),
    );

    expect(md).toContain("# Research stay abroad");
    expect(md).toContain("# CHI paper");
    expect(md).toContain("The contribution is the repertoire.");
  });

  it("notes the instant it was taken, since the workspace is time-indexed", () => {
    const md = workspaceToMarkdown([topic], new Map([[topic.id, []]]), { asOf: T });
    expect(md).toContain("as of 2026-08-08T09:00:00.000Z");
  });
});

describe("topicFilename", () => {
  it("uses the slug", () => {
    expect(topicFilename(topic)).toBe("research-stay-abroad.md");
  });

  it("falls back rather than producing a dotfile", () => {
    expect(topicFilename({ ...topic, slug: "" })).toBe("topic.md");
  });
});
