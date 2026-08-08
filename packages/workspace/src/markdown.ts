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
  const rest = blocks.filter((b) => b.kind !== "question");

  if (questions.length > 0) {
    lines.push("## Open questions");
    lines.push("");
    for (const q of questions) lines.push(`- [ ] ${q.text}`);
    lines.push("");
  }

  for (const block of rest) {
    switch (block.kind) {
      case "context":
        lines.push(`> ${block.text}`);
        break;
      case "meta":
        lines.push(`*${block.text}*`);
        break;
      default:
        lines.push(block.text);
    }
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

/** A filesystem-safe filename for a topic export. */
export function topicFilename(topic: Topic): string {
  return `${topic.slug || "topic"}.md`;
}
