/**
 * A Solari board, in arithmetic.
 *
 * The recorder shows one short title naming what is being talked about right
 * now, and when the subject changes the title has to change with it. A cut is
 * ambiguous at a glance — a peripheral look cannot tell "it changed" from "it
 * was always that" — so the change itself is the signal, and a split-flap is
 * the one kind of motion that IS the change rather than decoration around it.
 *
 * Kept pure and separate from the component so the flipping can be tested
 * without a DOM: the interesting part is which characters a cell passes
 * through, and that is a function, not a render.
 *
 * A real board cannot jump. Each drum turns through every character between
 * where it is and where it is going, which is why they take different lengths
 * of time to settle and why the noise rises and falls. `flapSequence` walks the
 * alphabet in order with wraparound for exactly that reason.
 */

/**
 * What a drum carries, in drum order.
 *
 * Blank first, so a cell that has nothing to show and a cell being cleared
 * agree on where "empty" is. Umlauts follow Z rather than sitting next to their
 * base letters — the board speaks whatever language the driver does, and German
 * is the second one — and the tail holds the few marks a two-to-four word title
 * actually uses. Anything else lands without travelling (see `flapSequence`).
 */
export const FLAP_ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789&-'";

/** The most drums any cell turns through, so no cell flips for long. */
const DEFAULT_MAX_STEPS = 8;

/**
 * The characters a single cell shows on its way from `from` to `to`.
 *
 * Excludes `from` (it is already showing) and includes `to` (it is where the
 * drum stops), so an unchanged cell returns nothing at all and never ticks.
 *
 * Only the LAST `maxSteps` are kept. A full turn of this alphabet is 42 drums,
 * which at any readable speed is several seconds of a screen that someone is
 * supposed to glance at — so a long journey starts partway round. The landing
 * is what carries the meaning; the run-up only has to say "this is moving".
 *
 * A character the alphabet does not carry — a letter from a language the board
 * has no drum for — flips through the tail of the alphabet and then lands on
 * itself, so it still reads as a cell that changed rather than as a cell that
 * was skipped.
 */
export function flapSequence(
  from: string,
  to: string,
  maxSteps: number = DEFAULT_MAX_STEPS,
): string[] {
  if (from === to) return [];

  const end = FLAP_ALPHABET.indexOf(to);
  if (end === -1) {
    // No drum for it. Run the tail of the alphabet and land on the character
    // itself, rather than not moving at all.
    const tail = FLAP_ALPHABET.slice(-maxSteps).split("");
    return [...tail.slice(0, Math.max(0, maxSteps - 1)), to];
  }

  const start = FLAP_ALPHABET.indexOf(from);
  // An unknown character is somewhere the drum cannot be, so treat it as blank
  // and travel from there: the cell still arrives in the right place.
  const at = start === -1 ? 0 : start;

  const steps: string[] = [];
  for (let i = 1; i <= FLAP_ALPHABET.length; i += 1) {
    const char = FLAP_ALPHABET[(at + i) % FLAP_ALPHABET.length]!;
    steps.push(char);
    if (char === to) break;
  }

  return steps.slice(-maxSteps);
}

/** One cell of the board: what it passes through, and when it starts. */
export interface FlapCell {
  /** The characters to show, in order. Empty for a cell that does not change. */
  steps: string[];
  /** How many ticks this cell waits before its first step. */
  offset: number;
}

/**
 * The whole board's move, cell by cell.
 *
 * Both strings are padded with blanks to the same length, which is what makes
 * a longer title GROW into blank cells and a shorter one flip its tail to
 * blank — on a real board every cell exists whether or not it is showing
 * anything, and the row is the row.
 *
 * `offset` staggers the cells left to right. A board where every drum starts
 * at once reads as one block changing; staggered, it reads as a board — and
 * the eye follows the ripple to where the word ends.
 */
export function flapPlan(prev: string, next: string): FlapCell[] {
  const width = Math.max(prev.length, next.length);
  const from = prev.padEnd(width, " ");
  const to = next.padEnd(width, " ");

  return Array.from({ length: width }, (_, i) => ({
    steps: flapSequence(from[i]!, to[i]!),
    offset: i,
  }));
}
