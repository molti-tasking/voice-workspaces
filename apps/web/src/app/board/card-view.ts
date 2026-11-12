import type { BoardCard, JudgedTransition, TaskState } from "@voicemural/workspace";
import { cardHref } from "./brief-view";

/**
 * What a card looks like once it has crossed to the browser.
 *
 * The board became a client component when it gained drag and drop, and this
 * is the seam. `BoardCard` carries the whole revision `history`, every
 * transition and the full `Block` — none of which the browser needs to draw a
 * card, and all of which would be serialised into the RSC payload on every
 * render. So the fold stays on the server and this crosses instead.
 *
 * Dates cross as ISO strings, not formatted text. Formatting in a client
 * component during SSR runs it twice, once on the server and once in the
 * browser, and the two disagree whenever their timezones do — a hydration
 * mismatch on a page whose whole job is to be trusted. Formatting on the
 * server instead would print the server's zone, which is wrong once the card
 * shows a time of day. `<When>` resolves both: empty during hydration, then
 * the reader's own zone.
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
  /** When the card was first added, as an ISO instant. See the note above. */
  createdAt: string;
  /** When it last moved or was reworded, as an ISO instant. */
  updatedAt: string;
  spanCount: number;
  /** How the card got to this column, in the person's terms. Null when silent. */
  marker: string | null;
  /**
   * Where the card's brief lives, already built.
   *
   * A string rather than the pieces to build one from: it keeps the payload
   * small and the `asOf` cursor — which the browser has no other way of knowing about — is resolved once,
   * on the server, instead of being re-derived per card.
   */
  href: string;
}

export function toCardView(
  card: BoardCard,
  outcome?: JudgedTransition,
  opts: { asOf?: Date } = {},
): CardView {
  return {
    cardId: card.cardId,
    blockId: card.block.id,
    text: card.block.text,
    state: card.state,
    topicTitle: card.topic.title,
    topicIcon: card.topic.icon,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    spanCount: card.block.spans.length,
    marker: markerFor(card, outcome),
    href: cardHref(card.cardId, opts.asOf),
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
 *
 * An imported card says so until something moves it, and never says "kept":
 * `judge()` does not score an import, so there is no verdict to report.
 */
export function markerFor(card: BoardCard, outcome?: JudgedTransition): string | null {
  const last = card.lastTransition;
  const previous = card.history[card.history.length - 2];
  let text: string | null = null;

  if (last.via === "speech" && last.from !== null) {
    text = outcome?.outcome === "kept" ? "moved here by speech · kept" : "moved here by speech";
  } else if (last.via === "import") {
    // An imported card has no drive behind it and no verdict to report: the
    // person put it there themselves, from a board they already kept. Saying so
    // is what stops "3 Sep" under the text reading as something they said.
    text = "brought in from another board";
  } else if (last.via === "agent") {
    // Asked aloud, so said as such: the person should be able to tell a move
    // they requested from one the extractor read into what they said.
    const verb = last.from === null ? "added by the agent" : "moved here by the agent";
    text = outcome?.outcome === "kept" ? `${verb} · kept` : verb;
  } else if (last.via === "user" && previous && previous.via !== "user") {
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
