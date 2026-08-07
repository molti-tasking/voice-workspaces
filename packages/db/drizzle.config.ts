// Load the repo-root .env before anything reads process.env. drizzle-kit does
// not do this for you, and in production Coolify injects the vars directly.
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // pgboss keeps its own schema; never let drizzle-kit try to manage it.
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
});
