/** The logic behind `global-error.tsx`, kept pure so it can be tested without a DOM. */

/**
 * How webpack, Next and the browser each name a failed chunk load.
 *
 * The same root cause — a stale tab asking for an asset a deploy has renamed
 * away — surfaces under several names across browsers, so all are matched.
 */
const CHUNK_ERROR_PATTERNS = [
  /Loading chunk \S+ failed/i,
  /Failed to load chunk/i,
  /Loading CSS chunk/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
];

/** True when an error is a stale-build chunk load failure. */
export function isChunkLoadError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  const text = typeof message === "string" ? message : "";
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Whether the boundary should reload the page for this chunk error.
 *
 * A reload cannot fix the 404, so it fetches the new build's document and its
 * new chunk names. It runs at most once per deploy: a second chunk error within
 * the guard window means the reload did not help, so we stop and let the person
 * retry by hand rather than reload forever.
 */
export function shouldReload({
  now,
  lastReloadAt,
  guardMs,
}: {
  now: number;
  lastReloadAt: number | null;
  guardMs: number;
}): boolean {
  if (lastReloadAt === null) return true;
  return now - lastReloadAt >= guardMs;
}
