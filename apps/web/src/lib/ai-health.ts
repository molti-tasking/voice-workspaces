"use client";

import { useEffect, useState } from "react";
// A type only: the package's runtime is server code.
import type { AiHealth } from "@voicemural/llm";

/**
 * Whether the AI proxy is usable, for the recorder (`/api/health/ai`): checked
 * on mount, every `intervalMs` while the page is visible, and on coming back
 * to it. Null until the first answer — the screen shows nothing rather than a
 * guess. If the app's own server cannot be reached, the last answer stands:
 * that is a different problem, and the recorder has its own words for it.
 */
export function useAiHealth(intervalMs = 30_000): AiHealth | null {
  const [health, setHealth] = useState<AiHealth | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      fetch("/api/health/ai", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<AiHealth>) : null))
        .then((body) => {
          if (!cancelled && body) setHealth(body);
        })
        .catch(() => undefined);
    };
    check();
    const timer = window.setInterval(check, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);
  return health;
}

/** What is wrong, in one sentence someone can act on; null when nothing is. */
export function aiHealthProblem(health: AiHealth | null): string | null {
  if (!health) return null;
  switch (health.status) {
    case "ok":
      return null;
    case "moved":
      return `The AI server has moved${health.movedTo ? ` to ${new URL(health.movedTo).host}` : ""}: update LITELLM_BASE_URL.`;
    case "unauthorized":
      return "The AI server refused the key: check LITELLM_API_KEY.";
    case "error":
      return `The AI server answered with an error${health.httpStatus ? ` (HTTP ${health.httpStatus})` : ""}.`;
    case "unreachable":
      return "The AI server is not answering.";
    case "unconfigured":
      return "No AI server is configured: set LITELLM_BASE_URL and LITELLM_API_KEY.";
  }
}
