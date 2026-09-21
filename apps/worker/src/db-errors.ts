/**
 * Whether an error is a dropped or refused Postgres connection rather than a
 * fault in the work itself.
 *
 * The pooled socket a database restart or redeploy leaves behind surfaces on
 * the next query as one of these — most often the bare "Connection terminated
 * unexpectedly" that `pg` throws with no error code, or "Connection terminated
 * due to connection timeout" when the pool cannot reach the server. The sweep
 * treats these as a retryable warning: the next pass reconnects, and nothing
 * enqueues but that loop, so no work is lost.
 */
const CONNECTION_ERROR_CODES = new Set([
  // Node socket errors.
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  // Postgres SQLSTATE class 08 — connection exceptions.
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  // Postgres SQLSTATE class 57 — operator intervention (restart, shutdown).
  "57P01",
  "57P02",
  "57P03",
]);

const CONNECTION_ERROR_PATTERNS = [
  "connection terminated",
  "terminating connection",
  "connection error and is not queryable",
  "server closed the connection",
  "connection timeout",
  "timeout exceeded when trying to connect",
];

export function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && CONNECTION_ERROR_CODES.has(code)) return true;

  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return CONNECTION_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}
