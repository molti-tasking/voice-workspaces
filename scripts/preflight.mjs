/**
 * Shared checks for `pnpm setup` and `pnpm dev`.
 *
 * No dependencies: this runs before `pnpm install` has necessarily happened.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_PATH = resolve(ROOT, ".env");

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
export { c };

export function ok(msg) {
  console.log(`${c.green("✓")} ${msg}`);
}
export function info(msg) {
  console.log(`${c.dim("·")} ${c.dim(msg)}`);
}

/** Print an actionable failure and exit. Never a bare stack trace. */
export function fail(title, ...lines) {
  console.error(`\n${c.red("✗")} ${c.bold(title)}`);
  for (const line of lines) console.error(`  ${line}`);
  console.error("");
  process.exit(1);
}

export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: opts.quiet ? "pipe" : "inherit",
    encoding: "utf8",
    ...opts,
  });
}

export function tryRun(cmd, args) {
  try {
    return { ok: true, out: run(cmd, args, { quiet: true }) };
  } catch (err) {
    return { ok: false, out: String(err.stdout ?? "") + String(err.stderr ?? "") };
  }
}

/** Minimal .env parser — avoids needing dotenv before install. */
export function readEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const out = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export function dockerRunning() {
  return tryRun("docker", ["info"]).ok;
}

/** Host/port from a postgres:// URL, with sane defaults. */
export function parsePgUrl(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname || "localhost", port: Number(u.port || 5432) };
  } catch {
    return { host: "localhost", port: 5432 };
  }
}

/** Can we open a TCP connection? Cheaper and clearer than a full query. */
export function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    const done = (result) => {
      socket.destroy();
      resolvePromise(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Poll until Postgres accepts connections, or give up. */
export async function waitForPostgres(host, port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`${c.dim("·")} ${c.dim(`waiting for postgres on ${host}:${port}`)}`);
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) {
      // pg_isready as well: the port opens slightly before the server is usable.
      const ready = tryRun("docker", [
        "exec",
        "voicemural-postgres",
        "pg_isready",
        "-U",
        "voicemural",
        "-d",
        "voicemural",
      ]);
      if (ready.ok) {
        process.stdout.write(` ${c.green("ready")}\n`);
        return true;
      }
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write(` ${c.red("timed out")}\n`);
  return false;
}

export const DOCKER_NOT_RUNNING = [
  "Docker Desktop is not running.",
  "",
  `  ${c.bold("open -a Docker")}   ${c.dim("(macOS — then wait for the whale icon)")}`,
  "",
  "Then run this again.",
];
