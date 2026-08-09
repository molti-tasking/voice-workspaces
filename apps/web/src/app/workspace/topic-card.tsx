import {
  topicFilename,
  topicToMarkdown,
  type Block,
  type Topic,
} from "@voicemural/workspace";
import { ExportButton } from "./export-button";
import { topicIcon } from "./icons";

/**
 * One topic as a small structured document.
 *
 * Nothing collapses. Hiding blocks behind a toggle made the card look complete
 * while withholding the point, and whichever blocks happened to be first were
 * rarely the interesting ones. Density comes from the extraction being
 * restrained and from facts becoming a table, not from hiding what was
 * extracted.
 *
 * Blocks are grouped by kind rather than left in the order they were spoken, so
 * a card reads as a document: what is still open, then what is thought, then
 * the attributes, then the asides.
 *
 * A pure server component apart from the download button.
 */
export function TopicCard({
  topic,
  blocks,
  allBlocks,
  highlight,
}: {
  topic: Topic;
  blocks: Block[];
  allBlocks: Map<string, Block>;
  /** Blocks a `?since=` diff touched; everything else recedes. */
  highlight?: Set<string>;
}) {
  const Icon = topicIcon(topic.icon);

  const questions = blocks.filter((b) => b.kind === "question");
  const claims = blocks.filter((b) => b.kind === "claim");
  const facts = blocks.filter((b) => b.kind === "fact");
  const asides = blocks.filter((b) => b.kind === "context" || b.kind === "meta");

  const faded = (b: Block) => highlight !== undefined && !highlight.has(b.id);

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/40 p-4">
      <header className="mb-3 flex items-start gap-2.5">
        <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-white/40" />
        <h2 className="min-w-0 flex-1 leading-tight font-medium">{topic.title}</h2>
        <ExportButton
          markdown={topicToMarkdown(topic, blocks)}
          filename={topicFilename(topic)}
          blockCount={blocks.length}
        />
      </header>

      <div className="space-y-3">
        {/* What is still owed. Loudest, and always first. */}
        {questions.length > 0 && (
          <ul className="space-y-1.5">
            {questions.map((b) => (
              <li
                key={b.id}
                className={`flex gap-2 text-sm leading-snug text-amber-300 ${faded(b) ? "opacity-30" : ""}`}
              >
                <span aria-hidden className="shrink-0 font-mono text-xs opacity-60">
                  ?
                </span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
        )}

        {/* The substance. */}
        {claims.length > 0 && (
          <ul className="space-y-1.5">
            {claims.map((b) => (
              <li
                key={b.id}
                className={`text-sm leading-snug ${faded(b) ? "opacity-30" : ""}`}
              >
                {b.text}
                <RevisionNote block={b} allBlocks={allBlocks} />
              </li>
            ))}
          </ul>
        )}

        {/* Attributes, as a table. Three sentences of prose become three short
            rows, which is most of where the card's density comes from. */}
        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-[var(--color-line)] pt-2.5 text-[13px]">
            {facts.map((b) => (
              <div key={b.id} className={`contents ${faded(b) ? "opacity-30" : ""}`}>
                <dt className="text-white/30">{b.label ?? "—"}</dt>
                <dd className="text-white/70">{b.text}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Prose context and the speaker's own asides. */}
        {asides.length > 0 && (
          <ul className="space-y-1 border-t border-[var(--color-line)] pt-2.5">
            {asides.map((b) => (
              <li
                key={b.id}
                className={[
                  "text-[13px] leading-snug",
                  b.kind === "meta" ? "text-sky-300/70 italic" : "text-white/40",
                  faded(b) ? "opacity-30" : "",
                ].join(" ")}
              >
                {b.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * What this block replaced.
 *
 * Still a `<details>`, because a superseded thought genuinely is secondary —
 * this is the balance sheet showing the balance, not every entry behind it.
 * The card no longer hides current content, only history.
 */
function RevisionNote({
  block,
  allBlocks,
}: {
  block: Block;
  allBlocks: Map<string, Block>;
}) {
  const history = revisionChain(block, allBlocks);
  if (history.length === 0) return null;

  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer list-none text-[10px] text-white/20 hover:text-white/50">
        revised · {history.length} earlier
      </summary>
      <ol className="mt-1 space-y-1 border-l border-[var(--color-line)] pl-2.5">
        {history.map((old) => (
          <li key={old.id} className="text-xs text-white/25 line-through">
            {old.text}
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Walk back through what a block replaced, newest first.
 *
 * Bounded: the chain comes from model output, and a cycle would hang rendering.
 */
function revisionChain(block: Block, allBlocks: Map<string, Block>): Block[] {
  const chain: Block[] = [];
  const seen = new Set<string>([block.id]);
  let cursor = block.supersedes;

  while (cursor && chain.length < 16 && !seen.has(cursor)) {
    const previous = allBlocks.get(cursor);
    if (!previous) break;
    chain.push(previous);
    seen.add(cursor);
    cursor = previous.supersedes;
  }

  return chain;
}
