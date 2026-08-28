/**
 * How much retrieved transcript is allowed into a turn.
 *
 * This existed before, in `buildTurnPrompt`, which nothing ever called — so the
 * live path grew an unbounded prompt while the code that would have bounded it
 * sat unused. It is applied in `buildContextPassages` now, which is the
 * function the live path actually reaches.
 *
 * Measured 2026-08-25: prompt size is NOT the dominant cost in
 * time-to-first-token on this proxy (a 6KB prompt was faster than a 192-char
 * one). So this is not a latency lever. It is here because past a point more
 * context makes the answer WORSE, not better, by burying the relevant line
 * under three unrelated ones — and because an unbounded prompt on an hour-long
 * drive is a bug regardless of what it costs.
 */

/** Lower than the 4000 this was written with: that number was chosen for a batch prompt. */
export const MAX_CONTEXT_CHARS = 2000;

/**
 * Keep the most recent lines that fit.
 *
 * Backwards, because recency is the tiebreak that matters: the line the driver
 * is about to refer to is the one they just said.
 */
export function trimToBudget(lines: string[], budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (used + line.length > budget) break;
    kept.unshift(line);
    used += line.length;
  }
  return kept;
}
