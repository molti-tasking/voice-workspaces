/**
 * Whether the LiteLLM proxy can be used right now, and if not, why — in
 * words a person can act on.
 *
 * ONE AUTHENTICATED REQUEST, `GET /models`, beside `/chat/completions`: cheap,
 * free of tokens, and it fails for every reason a real call would fail.
 * Redirects are NOT followed:
 * a proxy that moved host answers with a redirect, and a cross-host redirect
 * drops the Authorization header, so every real call after it fails with a
 * 401 that looks like a bad key (20 Oct 2026: litellm.stream.cavi.au.dk →
 * ai.cavi.au.dk). Reported as `moved`, with where to.
 */

import { litellmConfig } from "./config";

export type AiHealthStatus = "ok" | "moved" | "unauthorized" | "error" | "unreachable" | "unconfigured";

export interface AiHealth {
  status: AiHealthStatus;
  /** Round trip of the check, when there was one. */
  latencyMs?: number;
  /** For `moved`: the origin it redirects to. */
  movedTo?: string;
  /** For `error`: the HTTP status. */
  httpStatus?: number;
  checkedAt: string;
}

export async function checkLiteLLM({
  timeoutMs = 5000,
  now = () => Date.now(),
}: { timeoutMs?: number; now?: () => number } = {}): Promise<AiHealth> {
  const checkedAt = new Date(now()).toISOString();
  let config;
  try {
    config = litellmConfig();
  } catch {
    return { status: "unconfigured", checkedAt };
  }
  const started = now();
  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const latencyMs = now() - started;
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      let movedTo: string | undefined;
      try {
        movedTo = location ? new URL(location, config.baseUrl).origin : undefined;
      } catch {
        movedTo = undefined;
      }
      return { status: "moved", latencyMs, ...(movedTo ? { movedTo } : {}), checkedAt };
    }
    if (res.status === 401 || res.status === 403) return { status: "unauthorized", latencyMs, checkedAt };
    if (!res.ok) return { status: "error", latencyMs, httpStatus: res.status, checkedAt };
    return { status: "ok", latencyMs, checkedAt };
  } catch {
    return { status: "unreachable", latencyMs: now() - started, checkedAt };
  }
}
