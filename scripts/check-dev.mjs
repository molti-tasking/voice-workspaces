#!/usr/bin/env node
/**
 * Fast guard that runs before `pnpm dev`.
 *
 * Without it, a stopped Postgres container surfaces as ECONNREFUSED buried in a
 * Better Auth stack trace, repeated once per request — which reads like an
 * application bug rather than "the database is not running". Every check here
 * exists because its absence produced a confusing failure.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  DOCKER_NOT_RUNNING,
  ENV_PATH,
  ROOT,
  c,
  canConnect,
  dockerRunning,
  fail,
  parsePgUrl,
  readEnv,
  tryRun,
} from "./preflight.mjs";

const SETUP = `${c.bold("pnpm setup")}`;

if (!existsSync(ENV_PATH)) {
  fail("No .env file", `Run ${SETUP} to create one and start the database.`);
}

const env = readEnv();

if (!env.DATABASE_URL) {
  fail("DATABASE_URL is not set in .env", "Compare against .env.example.");
}

// getStorage() throws on a relative path; catching it here explains why.
if (!env.STORAGE_DIR) {
  fail("STORAGE_DIR is not set in .env", `Run ${SETUP}, or set it to an absolute path.`);
}
if (!env.STORAGE_DIR.startsWith("/")) {
  fail(
    "STORAGE_DIR must be an absolute path",
    `Currently: ${c.yellow(env.STORAGE_DIR)}`,
    "",
    "Web, worker and the seed scripts each run from a different working",
    "directory, so a relative path scatters one session's audio across three",
    "folders — silently.",
    "",
    `Suggested:  ${c.bold(`STORAGE_DIR=${resolve(ROOT, "storage")}`)}`,
  );
}

const { host, port } = parsePgUrl(env.DATABASE_URL);

if (!(await canConnect(host, port))) {
  const dockerUp = dockerRunning();
  if (!dockerUp) fail("Postgres is not reachable", ...DOCKER_NOT_RUNNING);

  const ps = tryRun("docker", [
    "compose",
    "ps",
    "--format",
    "{{.Name}} {{.State}}",
  ]);
  const containerKnown = ps.ok && ps.out.includes("voicemural-postgres");

  fail(
    `Postgres is not accepting connections on ${host}:${port}`,
    containerKnown
      ? "The container exists but is not running — Docker Desktop restarting will do this."
      : "The container is not running.",
    "",
    `  ${c.bold("docker compose up -d postgres")}   ${c.dim("start it")}`,
    `  ${SETUP}                        ${c.dim("or do the whole setup again")}`,
  );
}

// Advisory only: the worker's own preflight reports model problems in detail.
if (!env.LITELLM_BASE_URL || env.LITELLM_BASE_URL.includes("your-instance.example")) {
  console.log(
    `${c.yellow("!")} LiteLLM is not configured — recording works, transcription will not.`,
  );
}

console.log(`${c.green("✓")} environment looks good — starting dev servers\n`);
