#!/usr/bin/env node
/**
 * One command from a fresh clone to a running local environment.
 *
 *   pnpm setup
 *
 * Idempotent — safe to re-run any time something looks off. It will not
 * overwrite an existing .env.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DOCKER_NOT_RUNNING,
  ENV_PATH,
  ROOT,
  c,
  dockerRunning,
  fail,
  info,
  ok,
  parsePgUrl,
  readEnv,
  run,
  tryRun,
  waitForPostgres,
} from "./preflight.mjs";

console.log(`\n${c.bold("VoiceMural — local setup")}\n`);

/* 1 ── .env ---------------------------------------------------------------- */
if (existsSync(ENV_PATH)) {
  ok(".env exists (left untouched)");
} else {
  copyFileSync(resolve(ROOT, ".env.example"), ENV_PATH);

  let env = readFileSync(ENV_PATH, "utf8");

  // STORAGE_DIR must be absolute — getStorage() refuses a relative path,
  // because web, worker and the seed scripts each run from a different
  // directory and would otherwise scatter one session's audio across three
  // folders. Fill in the real path so a fresh clone just works.
  env = env.replace(
    /^STORAGE_DIR=.*$/m,
    `STORAGE_DIR=${resolve(ROOT, "storage")}`,
  );

  env = env.replace(
    /^BETTER_AUTH_SECRET=.*$/m,
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
  );

  writeFileSync(ENV_PATH, env);
  ok(".env created (storage path + auth secret filled in)");
  info("LiteLLM values are still placeholders — transcription needs them.");
}

/* 2 ── Docker + Postgres --------------------------------------------------- */
if (!dockerRunning()) fail("Cannot reach Docker", ...DOCKER_NOT_RUNNING);
ok("Docker is running");

const up = tryRun("docker", ["compose", "up", "-d", "postgres"]);
if (!up.ok) fail("Could not start Postgres", up.out.trim());
ok("Postgres container up");

const { host, port } = parsePgUrl(readEnv().DATABASE_URL ?? "");
if (!(await waitForPostgres(host, port))) {
  fail(
    "Postgres never became ready",
    `Check the logs:  ${c.bold("docker compose logs postgres")}`,
  );
}

/* 3 ── Dependencies -------------------------------------------------------- */
if (existsSync(resolve(ROOT, "node_modules"))) {
  ok("Dependencies already installed");
} else {
  info("Installing dependencies…");
  run("pnpm", ["install"]);
  ok("Dependencies installed");
}

/* 4 ── Migrations ---------------------------------------------------------- */
info("Applying migrations…");
const migrated = tryRun("pnpm", ["db:migrate"]);
if (!migrated.ok) fail("Migrations failed", migrated.out.trim().split("\n").slice(-8).join("\n  "));
ok("Database schema up to date");

/* 5 ── Done ---------------------------------------------------------------- */
console.log(`
${c.green(c.bold("Ready."))}

  ${c.bold("pnpm dev")}            start web (:3000) and worker
  ${c.bold("pnpm db:fixtures")}    add a demo session once you have signed in

Open http://localhost:3000 and hit ${c.bold("Start recording")} — no account needed.

${c.dim("Transcription needs a LiteLLM instance; set LITELLM_* and MODEL_* in .env.")}
${c.dim("The worker checks those on startup and tells you if a model name is wrong.")}
`);
