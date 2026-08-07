-- Pre-migration DDL: extensions and the pgboss schema.
--
-- Applied by `src/init-db.ts`, which runs as the first half of
-- `pnpm db:migrate`. Every statement is IF NOT EXISTS, so it is safe to run on
-- every deploy — and it must be, because Postgres lives outside this repo's
-- compose file in production and there is no initdb hook to rely on.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- pg-boss owns this schema and creates its own tables on first start.
-- drizzle.config.ts sets schemaFilter to `public` so migrations never touch it.
CREATE SCHEMA IF NOT EXISTS pgboss;
