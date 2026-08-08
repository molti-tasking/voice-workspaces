import { topicFilename, topicToMarkdown, type Block, type BlockKind, type Topic } from "@voicemural/workspace";
import { ExportButton } from "./export-button";
import { BLOCK_ICONS, topicIcon } from "./icons";

/**
 * Blocks shown before the card collapses the rest.
 *
 * Three, not five. The card has to be readable at a glance across a dozen
 * topics; anything longer and the grid stops being a summary and becomes a
 * document you have to read.
 */
const VISIBLE_BLOCKS = 3;

const KIND_STYLE: Record<BlockKind, string> = {
  // The substance. Everything else is quieter than this.
  claim: "text-white",
  // Unresolved — what is still owed, so it gets the loudest colour.
  question: "text-amber-300",
  // Supports a claim without being one.
  context: "text-white/45 text-[13px]",
  // The speaker commenting on their own content: the Midas-touch category,
  // made visible here rather than hidden as it is in the transcript.
  meta: "text-sky-300/80 italic",
};

/**
 * One topic as a small document.
 *
 * A server component throughout except the download button: expansion uses
 * <details>, so a workspace of fifty topics ships almost no JavaScript.
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
  /** Blocks a `?since=` diff added or revised, dimmed against otherwise. */
  highlight?: Set<string>;
}) {
  const Icon = topicIcon(topic.icon);

  // Open questions first regardless of when they were said — an unanswered
  // question buried under later chatter is exactly what a glanceable summary
  // must not do. Everything else stays chronological.
  const ordered = [
    ...blocks.filter((b) => b.kind === "question"),
    ...blocks.filter((b) => b.kind !== "question"),
  ];

  const head = ordered.slice(0, VISIBLE_BLOCKS);
  const tail = ordered.slice(VISIBLE_BLOCKS);

  return (
    <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/40 p-4">
      <header className="mb-3 flex items-start gap-2.5">
        <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-white/40" />
        <h2 className="min-w-0 flex-1 leading-tight font-medium">{topic.title}</h2>
        <ExportButton
          markdown={topicToMarkdown(topic, blocks)}
          filename={topicFilename(topic)}
        />
      </header>

      <ul className="space-y-2">
        {head.map((block) => (
          <BlockRow
            key={block.id}
            block={block}
            allBlocks={allBlocks}
            highlight={highlight}
          />
        ))}
      </ul>

      {tail.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer list-none text-xs text-white/30 hover:text-white/60">
            +{tail.length} more
          </summary>
          <ul className="mt-2 space-y-2">
            {tail.map((block) => (
              <BlockRow
                key={block.id}
                block={block}
                allBlocks={allBlocks}
                highlight={highlight}
              />
            ))}
          </ul>
        </details>
      )}

      <footer className="mt-3 flex items-center justify-between text-[10px] text-white/20">
        <span>
          {blocks.length} block{blocks.length === 1 ? "" : "s"}
        </span>
        <span>
          {topic.lastTouchedAt.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </footer>
    </section>
  );
}

function BlockRow({
  block,
  allBlocks,
  highlight,
}: {
  block: Block;
  allBlocks: Map<string, Block>;
  highlight?: Set<string>;
}) {
  const history = revisionChain(block, allBlocks);
  const Icon = BLOCK_ICONS[block.kind];
  // In diff mode everything untouched recedes, so the change reads at a glance
  // without hiding the context it landed in.
  const faded = highlight !== undefined && !highlight.has(block.id);

  return (
    <li className={`text-sm leading-snug ${faded ? "opacity-30" : ""}`}>
      <div className="flex gap-2">
        {Icon ? (
          <Icon
            size={13}
            aria-hidden
            className={`mt-0.5 shrink-0 ${KIND_STYLE[block.kind]} opacity-70`}
          />
        ) : (
          <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-white/30" />
        )}
        <span className={KIND_STYLE[block.kind]}>{block.text}</span>
      </div>

      {history.length > 0 && (
        // Current state by default, history one click away — the balance sheet
        // shows the balance, not every entry that produced it.
        <details className="mt-1 ml-5">
          <summary className="cursor-pointer list-none text-[10px] text-white/25 hover:text-white/50">
            revised · {history.length} earlier
          </summary>
          <ol className="mt-1 space-y-1 border-l border-[var(--color-line)] pl-3">
            {history.map((old) => (
              <li key={old.id} className="text-xs text-white/30 line-through">
                {old.text}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

/**
 * Walk back through what this block replaced, newest first.
 *
 * Bounded: the chain is built from model output, and a cycle would otherwise
 * hang rendering.
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
