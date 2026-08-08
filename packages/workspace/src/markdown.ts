import type { Block, Topic } from "./types";

/**
 * Render a topic as a Markdown document.
 *
 * Pure, so it is testable without a browser and reusable by anything that needs
 * to get a topic out of the system — the `diary` and `to-doc` capabilities in
 * the starter repertoire both want exactly this shape.
 *
 * Block kinds map to Markdown structure rather than to styling, because the
 * export has to survive being pasted into a paper draft where the colours are
 * gone:
 *
 *   - open questions become a leading checklist — they are what is still owed
 *   - claims become plain paragraphs, the substance
 *   - context becomes a blockquote, subordinate by construction
 *   - meta becomes an italic aside
 */
export function topicToMarkdown(
  topic: Topic,
  blocks: readonly Block[],
  options: { includeFrontmatter?: boolean; asOf?: Date } = {},
): string {
  const lines: string[] = [];

  if (options.includeFrontmatter) {
    lines.push("---");
    lines.push(`title: ${JSON.stringify(topic.title)}`);
    lines.push(`slug: ${topic.slug}`);
    if (options.asOf) lines.push(`as_of: ${options.asOf.toISOString()}`);
    lines.push(`last_touched: ${topic.lastTouchedAt.toISOString()}`);
    lines.push("---");
    lines.push("");
  }

  lines.push(`# ${topic.title}`);
  lines.push("");

  const questions = blocks.filter((b) => b.kind === "question");
  const facts = blocks.filter((b) => b.kind === "fact");
  const claims = blocks.filter((b) => b.kind === "claim");
  const rest = blocks.filter(
    (b) => b.kind === "context" || b.kind === "meta",
  );

  if (questions.length > 0) {
    lines.push("## Open questions");
    lines.push("");
    for (const q of questions) lines.push(`- [ ] ${q.text}`);
    lines.push("");
  }

  if (facts.length > 0) {
    // A real Markdown table. Attributes are the one part of a topic with
    // genuine structure, and a table is both the densest way to read them and
    // the form that survives being pasted into a paper or a notes app.
    lines.push("## Details");
    lines.push("");
    lines.push("| | |");
    lines.push("| :-- | :-- |");
    for (const f of facts) {
      lines.push(`| **${escapeCell(f.label ?? "—")}** | ${escapeCell(f.text)} |`);
    }
    lines.push("");
  }

  for (const block of claims) {
    lines.push(block.text);
    lines.push("");
  }

  for (const block of rest) {
    lines.push(block.kind === "meta" ? `*${block.text}*` : `> ${block.text}`);
    lines.push("");
  }

  // Exactly one trailing newline: a file, not a fragment.
  return `${lines.join("\n").trimEnd()}\n`;
}

/** Whole workspace as one document, topics in the order given. */
export function workspaceToMarkdown(
  topics: readonly Topic[],
  blocksByTopic: ReadonlyMap<string, Block[]>,
  options: { asOf?: Date } = {},
): string {
  const parts = topics.map((topic) =>
    topicToMarkdown(topic, blocksByTopic.get(topic.id) ?? []),
  );
  const header = options.asOf
    ? `<!-- VoiceMural workspace as of ${options.asOf.toISOString()} -->\n\n`
    : "";
  return header + parts.join("\n");
}

/** A pipe inside a cell would split it into two columns. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

/** A filesystem-safe filename for a topic export. */
export function topicFilename(topic: Topic): string {
  return `${topic.slug || "topic"}.md`;
}
