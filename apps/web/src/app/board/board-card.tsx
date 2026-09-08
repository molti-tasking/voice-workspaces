import type { BoardCard as Card, JudgedTransition } from "@voicemural/workspace";
import { topicIcon } from "@/app/workspace/icons";
import { CardActions } from "./card-actions";

/**
 * One card: the task, where it came from, and how it got to this column.
 *
 * The marker under the text is the thing this page exists to show. A card
 * speech moved says so, until the person either leaves it long enough to count
 * as kept or moves it themselves — and when they do, the card says which way.
 * The evaluation counts these from the ledger; the card just makes the count
 * legible to the person it is about.
 *
 * A server component apart from the buttons.
 */
export function BoardCard({ card, outcome }: { card: Card; outcome?: JudgedTransition }) {
  const Icon = topicIcon(card.topic.icon);
  const { block } = card;

  return (
    <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/40 p-3">
      <header className="mb-1.5 flex items-center gap-1.5 text-[11px] text-white/30">
        {/*
          `topicIcon` selects from a module-level map of Lucide components, so
          the identity is stable for a given name; the rule cannot see through
          the lookup. Same as `workspace/topic-card.tsx`.
        */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{card.topic.title}</span>
        <StateChip state={card.state} />
      </header>

      <p className="text-sm leading-snug">{block.text}</p>

      <p className="mt-1.5 text-[11px] text-white/30">
        said{" "}
        {block.occurredAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ·{" "}
        {block.spans.length} utterance{block.spans.length === 1 ? "" : "s"}
      </p>

      <Marker card={card} outcome={outcome} />

      <CardActions blockId={block.id} state={card.state} />
    </article>
  );
}

/** How the card got here, in the person's terms. */
function Marker({ card, outcome }: { card: Card; outcome?: JudgedTransition }) {
  const last = card.lastTransition;
  const previous = card.history[card.history.length - 2];
  let text: string | null = null;

  if (last.via === "speech" && last.from !== null) {
    text = outcome?.outcome === "kept" ? "moved here by speech · kept" : "moved here by speech";
  } else if (last.via === "user" && previous?.via === "speech") {
    text = last.to === previous.from ? "you moved it back" : "you moved it on";
  } else if (last.via === "user") {
    text = "you moved it";
  }

  if (card.staleSessions >= 2) {
    const stale = `untouched for ${card.staleSessions} drives`;
    text = text ? `${text} · ${stale}` : stale;
  }

  if (!text) return null;
  return <p className="mt-1 font-mono text-[10px] text-amber-300/70">{text}</p>;
}

function StateChip({ state }: { state: Card["state"] }) {
  const tone =
    state === "done"
      ? "text-emerald-300/80"
      : state === "dropped"
        ? "text-white/30 line-through"
        : state === "open"
          ? "text-white/50"
          : "text-amber-300";
  return <span className={`ml-auto shrink-0 font-mono text-[10px] ${tone}`}>{state}</span>;
}
