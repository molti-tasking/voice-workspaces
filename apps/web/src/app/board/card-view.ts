import type { BoardCard, JudgedTransition, TaskState } from "@voicemural/workspace";

/**
 * What a card looks like once it has crossed to the browser.
 *
 * The board became a client component when it gained drag and drop, and this
 * is the seam. `BoardCard` carries the whole revision `history`, every
 * transition and the full `Block` — none of which the browser needs to draw a
 * card, and all of which would be serialised into the RSC payload on every
 * render. So the fold stays on the server and this crosses instead.
 *
 * The date arrives PRE-FORMATTED for the same reason it always was: rendering
 * `toLocaleDateString` in a client component runs it twice, once on the server
 * during SSR and once in the browser, and the two disagree whenever their
 * timezones do — a hydration mismatch on a page whose whole job is to be
 * trusted. Formatting here keeps the behaviour identical to the server
 * component this replaced.
 */
export interface CardView {
  /** Root of the revision chain: stable across moves, and the React key. */
  cardId: string;
  /** The CURRENT head block — what a move must be aimed at. */
  blockId: string;
  text: string;
  state: TaskState;
  topicTitle: string;
  /** Icon NAME, resolved through `topicIcon` in the browser. */
  topicIcon: string;
  /** Already formatted. See the note above. */
  said: string;
  spanCount: number;
  /** How the card got to this column, in the person's terms. Null when silent. */
  marker: string | null;
}

export function toCardView(card: BoardCard, outcome?: JudgedTransition): CardView {
  return {
    cardId: card.cardId,
    blockId: card.block.id,
    text: card.block.text,
    state: card.state,
    topicTitle: card.topic.title,
    topicIcon: card.topic.icon,
    said: card.block.occurredAt.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    }),
    spanCount: card.block.spans.length,
    marker: markerFor(card, outcome),
  };
}

/**
 * How the card got here.
 *
 * The line this page exists to show. A card speech moved says so until the
 * person either leaves it long enough to count as kept or moves it themselves
 * — and when they do, it says which way. The evaluation counts these off the
 * ledger; this only makes the count legible to the person it is about.
 *
 * Pure and separated from the component so it can be tested, which matters:
 * "you moved it back" versus "you moved it on" is the distinction the study
 * turns on, and it is decided here by comparing against the transition BEFORE
 * the person's, not against the card's current state.
 */
export function markerFor(card: BoardCard, outcome?: JudgedTransition): string | null {
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

  return text;
}
