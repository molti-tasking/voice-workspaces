-- Extensions the application expects. Runs once, on first cluster creation.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- pg-boss owns this schema and creates its own tables on first start.
-- drizzle.config.ts sets schemaFilter to `public` so migrations never touch it.
CREATE SCHEMA IF NOT EXISTS pgboss;
