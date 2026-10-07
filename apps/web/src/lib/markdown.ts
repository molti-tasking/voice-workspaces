/**
 * The markdown a draft is written in, parsed into a few block and inline kinds.
 *
 * The model is told markdown is allowed inside a draft, and nothing rendered
 * it: on 7 Oct 2026 a draft arrived on the recording screen as
 * "**Search Tool Reliability:** Failed to…", asterisks and all.
 *
 * Deliberately small, and a parser rather than a library: drafts use
 * headings, bullet and numbered lists, bold, italic, inline code and the odd
 * link, and anything else is left as the text it is. The output is data, so
 * the component builds React elements from it and no HTML string is ever
 * injected. Underscores are NOT emphasis here: `snake_case` and file names
 * turn up in drafts, and italicising half of one is worse than leaving `_x_`.
 *
 * Copy still copies the raw text: this is how a draft is READ, not what it is.
 */

export type Inline =
  | { kind: "text" | "strong" | "em" | "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type Block =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] | null = null;
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const close = () => {
    if (paragraph) blocks.push({ kind: "paragraph", lines: paragraph });
    if (list) blocks.push({ kind: "list", ...list });
    paragraph = null;
    list = null;
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      close();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      close();
      blocks.push({ kind: "heading", level: heading[1]!.length, inline: parseInline(heading[2]!) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = numbered !== null;
      if (!list || list.ordered !== ordered) {
        close();
        list = { ordered, items: [] };
      }
      list.items.push(parseInline(item[1]!));
      continue;
    }

    // A line under a list item with no marker continues that item, as it
    // would in any renderer; otherwise it is a line of the paragraph. Line
    // breaks inside a paragraph are kept: drafts are emails and notes, and
    // joining "Hi William," onto the next line would rewrite them.
    if (list) {
      const last = list.items[list.items.length - 1]!;
      last.push({ kind: "text", text: " " }, ...parseInline(line.trim()));
      continue;
    }
    paragraph ??= [];
    paragraph.push(parseInline(line));
  }
  close();
  return blocks;
}

/** `**bold**`, `*italic*`, `` `code` `` and `[text](https://…)`; the rest is text. */
const INLINE = /(\*\*[^*\n]+?\*\*|`[^`\n]+`|\*[^*\s][^*\n]*?\*|\[[^\]\n]+\]\([^)\s]+\))/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const start = match.index;
    if (start > at) out.push({ kind: "text", text: text.slice(at, start) });
    at = start + token.length;

    if (token.startsWith("**")) {
      out.push({ kind: "strong", text: token.slice(2, -2) });
    } else if (token.startsWith("`")) {
      out.push({ kind: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("[")) {
      const close = token.indexOf("](");
      const label = token.slice(1, close);
      const href = token.slice(close + 2, -1);
      // Only where a link can safely go. Anything else — `javascript:` above
      // all — stays visible as the text it is.
      out.push(isSafeHref(href) ? { kind: "link", text: label, href } : { kind: "text", text: token });
    } else {
      out.push({ kind: "em", text: token.slice(1, -1) });
    }
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
  return out;
}

function isSafeHref(href: string): boolean {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}
