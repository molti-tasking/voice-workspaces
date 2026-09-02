/**
 * The rules the secondary display obeys.
 *
 * Constants rather than CSS, because they are the contribution. The claim is
 * that a display alongside a voice interaction can extend someone's thinking
 * space instead of competing for it, and every number here is a commitment
 * about how — citable, testable, and changeable in one place rather than spread
 * across a component.
 *
 * The situation these are written for: the person's primary task is something
 * else. They are not reading this screen, they are glancing at it, from a metre
 * away, between two other things. A glance is about a second and a half, which
 * is four short lines. Everything below follows from that.
 */

/**
 * Nothing may move when a cue arrives.
 *
 * Layout shift is what makes someone look — the eye is drawn to motion long
 * before it is drawn to text — so the panel reserves its full height from the
 * moment it appears and holds it whether it is full or empty.
 */
export const PANEL_MIN_ROWS = 5;

/**
 * How long an item is guaranteed on screen before it can be replaced.
 *
 * Without this, a phone draining a dead-zone backlog commits eight utterances
 * at once and the whole panel turns over in a single frame — the one moment a
 * peripheral display must not demand attention. Arrivals queue and release.
 */
export const MIN_DWELL_MS = 8_000;

/** The only animation. No slide, no colour flash, and only on the new item. */
export const ENTER_MS = 400;

/**
 * Hard truncation, applied at render.
 *
 * The extractor already writes short blocks, but "short" for a document is long
 * for a glance, and paying a second model call to shorten prose that is about
 * to be read in a second and a half would be absurd. Cut it and let the full
 * text stay where full text belongs — the workspace.
 */
export const MAX_CUE_WORDS = 8;

/** How often the browser asks again after falling back from the stream. */
export const POLL_INTERVAL_MS = 10_000;

/** Stream errors tolerated before giving up on SSE for this session. */
export const STREAM_ERRORS_BEFORE_POLLING = 2;

/**
 * Trim to a glance.
 *
 * Word-wise rather than character-wise: a cut mid-word reads as a rendering
 * fault and costs a second look, which is the thing being economised.
 */
export function toGlance(text: string, maxWords = MAX_CUE_WORDS): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

/**
 * Merge an incoming list into what is on screen without reordering it.
 *
 * The rule that matters most. Items already visible keep their slot; new items
 * enter at the top; anything pushed past the budget falls off the bottom.
 * Re-sorting a peripheral list forces a re-read of the whole thing, which is
 * exactly the working-memory cost the display exists to avoid — so an item's
 * position, once taken, is stable for as long as it is shown.
 *
 * Pure and generic over the item type so it can be tested directly.
 */
export function settle<T extends { id: string }>(
  visible: readonly T[],
  incoming: readonly T[],
  budget: number,
): T[] {
  if (budget <= 0) return [];

  const incomingById = new Map(incoming.map((item) => [item.id, item]));

  // Held slots first, in the order they already occupy, refreshed in place so
  // an edit to an item's text does not move it.
  const kept = visible
    .filter((item) => incomingById.has(item.id))
    .map((item) => incomingById.get(item.id) ?? item);

  const keptIds = new Set(kept.map((item) => item.id));

  // Newest first among the arrivals: `incoming` is oldest-first, and the top of
  // the panel is where the eye lands.
  const arrivals = [...incoming].reverse().filter((item) => !keptIds.has(item.id));

  return [...arrivals, ...kept].slice(0, budget);
}
