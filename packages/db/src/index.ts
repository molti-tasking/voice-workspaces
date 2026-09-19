import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  sum,
} from "drizzle-orm";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }
  return url;
}

let client: ReturnType<typeof postgres> | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Shared connection pool.
 *
 * Next.js dev reloads modules on every edit, so the instance is cached on
 * globalThis to avoid leaking a pool per reload and exhausting Postgres
 * connections after a few dozen saves.
 */
const globalForDb = globalThis as unknown as {
  __voicemural_pg?: ReturnType<typeof postgres>;
};

export function getDb() {
  if (!dbInstance) {
    client =
      globalForDb.__voicemural_pg ??
      postgres(connectionString(), {
        max: Number(process.env.PG_POOL_MAX ?? 10),
        idle_timeout: 20,
        // Chunk uploads and Whisper calls are the slow paths, not queries.
        connect_timeout: 10,
      });
    if (process.env.NODE_ENV !== "production") {
      globalForDb.__voicemural_pg = client;
    }
    dbInstance = drizzle(client, { schema });
  }
  return dbInstance;
}

export type Database = ReturnType<typeof getDb>;

/**
 * Anything that can run a query: the pool, or one transaction on it.
 *
 * Query helpers take this so a caller holding a transaction can pass it in and
 * have the work land INSIDE that transaction. Without it a helper would reach
 * for `getDb()` and take a different connection out of the pool — which is
 * silently wrong under a lock, because the critical section would be guarded
 * while its writes happened outside.
 */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Close the pool. Used by the worker's shutdown path and by scripts. */
export async function closeDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = undefined;
  dbInstance = undefined;
  delete globalForDb.__voicemural_pg;
}
