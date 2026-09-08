/**
 * The rules the secondary display obeys.
 *
 * Constants rather than CSS, because they are the contribution. The claim is
 * that a display alongside a voice interaction can extend someone's thinking
 * space instead of competing for it, and every number here is a commitment
 * about how — citable, testable, and changeable in one place rather than spread
 * across a component.
 *
 * There are TWO situations, and the first version of this file only served one.
 *
 * `glance` — hands in the sink, phone propped a metre away, the screen caught
 * for a second between two other things. Few items, short, held still.
 *
 * `read` — the screen is genuinely in front of them. Glanceability has stopped
 * being the constraint, and holding to eight words is no longer restraint, it
 * is withholding: what is worth showing here is the workspace forming, as the
 * small structured document it actually is.
 *
 * The rules below therefore come in pairs, keyed on `SettingProfile.density`.
 * Applying the at-110km/h numbers to someone at a desk is the specific mistake
 * this shape exists to prevent — and the numbers were never used while driving
 * anyway, because `driving` renders no panel at all.
 */

export type Density = "glance" | "read";

export interface DisplayRules {
  /**
   * Rows the panel reserves whether or not it is full.
   *
   * Layout shift is what makes someone look — the eye finds motion long before
   * it finds text — so the height is held from the first render. It matters
   * most at a glance and is worth keeping at a desk, where a list that grows
   * under the cursor is merely annoying rather than dangerous.
   */
  minRows: number;
  /**
   * How long an item is guaranteed on screen before it can be replaced.
   *
   * Without a floor, a phone draining a dead-zone backlog commits eight
   * utterances at once and the whole panel turns over in one frame. That is
   * intolerable in the corner of someone's eye and merely brisk in front of
   * their face, so the floor drops with the density.
   */
  dwellMs: number;
  /**
   * Words per item, or `null` to show the block as written.
   *
   * The extractor already writes one clause per block. "Short" for a document
   * is still long for a glance, so glance mode cuts; read mode does not, and
   * paying a model call to shorten prose nobody is squinting at would be
   * absurd in either.
   */
  maxWords: number | null;
  /** Group content under its topic, rather than as one flat run. */
  groupByTopic: boolean;
}

export const DISPLAY_RULES: Record<Density, DisplayRules> = {
  glance: { minRows: 5, dwellMs: 8_000, maxWords: 8, groupByTopic: false },
  read: { minRows: 6, dwellMs: 2_500, maxWords: null, groupByTopic: true },
};

/** The only animation, at either density. No slide, no colour flash. */
export const ENTER_MS = 400;

/** Kept for the glance path and for tests that assert the cut length. */
export const MAX_CUE_WORDS = DISPLAY_RULES.glance.maxWords ?? 8;

/** The longest dwell any density asks for; the bound on how late a cue can be. */
export const MIN_DWELL_MS = DISPLAY_RULES.glance.dwellMs;

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
export function toGlance(text: string, maxWords: number | null = MAX_CUE_WORDS): string {
  const words = text.trim().split(/\s+/);
  if (maxWords === null || words.length <= maxWords) return words.join(" ");
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

/**
 * Group content under its topic, without reordering anything.
 *
 * Topics appear in the order their first visible block does, and blocks keep
 * the order `settle` put them in. That is the whole constraint: a topic gaining
 * a block must not jump the list, or the reader loses their place in a panel
 * they are only half looking at.
 *
 * Pure and generic over the item type, so the read view's one piece of
 * arithmetic is testable without rendering anything.
 */
export function groupByTopic<T extends { topic?: string }>(
  cues: readonly T[],
  fallback = "Unfiled",
): { topic: string; cues: T[] }[] {
  const groups: { topic: string; cues: T[] }[] = [];

  for (const cue of cues) {
    const topic = cue.topic?.trim() || fallback;
    const existing = groups.find((g) => g.topic === topic);
    if (existing) existing.cues.push(cue);
    else groups.push({ topic, cues: [cue] });
  }

  return groups;
}
