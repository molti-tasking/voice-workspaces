/**
 * Apply `sql/init.sql` — extensions and the pgboss schema — before migrations.
 *
 * This exists because Postgres's `docker-entrypoint-initdb.d` only fires on
 * first cluster creation. That was fine while Postgres was a service in this
 * repo's compose file, but in production it is a managed database created
 * outside it, so no initdb hook of ours ever runs. Relying on it would leave
 * the extensions silently absent — and the failure would surface much later,
 * as a migration error on the first schema change that needs one.
 *
 * Chained into `pnpm db:migrate`, so it runs on every deploy in dev and in
 * production through the same code path. Every statement is IF NOT EXISTS, so
 * repeated runs are no-ops.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";

// Built from runtime values rather than a `new URL(..., import.meta.url)`
// literal: bundlers treat that literal as a module reference and fail the build
// when no .env is present, which is exactly the case in a clean CI checkout.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "..", "..", "..", ".env"), quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. See .env.example.");
  }

  const ddlPath = resolve(here, "..", "sql", "init.sql");
  const ddl = readFileSync(ddlPath, "utf8");

  // max: 1 — this is a one-shot script, not a serving path.
  const client = postgres(url, { max: 1, connect_timeout: 10 });
  try {
    // `unsafe` is the multi-statement escape hatch; the input is our own file,
    // never user data.
    await client.unsafe(ddl);
    console.log("init-db: extensions and pgboss schema are in place");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // Print the error object when there is no usable message: postgres.js throws
  // connection errors whose `message` is empty but which carry a `code`, and a
  // bare "init-db failed:" with nothing after it tells you nothing.
  const detail = err instanceof Error && err.message ? err.message : err;
  console.error("init-db failed:", detail);
  console.error("Check that DATABASE_URL points at a reachable database.");
  // Non-zero exit matters: the compose `migrate` service gates web and worker on
  // it, so a failure here must stop the deploy rather than start a half-ready app.
  process.exit(1);
});
