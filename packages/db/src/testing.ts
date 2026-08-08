import { createConnection } from "node:net";

/**
 * Whether the database is actually reachable.
 *
 * Integration tests gate on this rather than on DATABASE_URL being set. The
 * variable is always set locally, so keying off it means a stopped Postgres
 * turns into a wall of connection errors that look like broken code. Probing
 * the socket lets the suite skip honestly instead — and still run the tests
 * wherever a database really is up.
 */
export async function isDatabaseReachable(timeoutMs = 1500): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;

  let host = "localhost";
  let port = 5432;
  try {
    const parsed = new URL(url);
    host = parsed.hostname || host;
    port = Number(parsed.port || 5432);
  } catch {
    return false;
  }

  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
