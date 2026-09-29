"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Stream errors tolerated before falling back to asking on a timer. */
const STREAM_ERRORS_BEFORE_POLLING = 2;
/** How often the fallback asks. Slower than the stream's tick: it is the degraded path. */
const POLL_INTERVAL_MS = 5_000;

/**
 * Redraw the board when its op log changes underneath it.
 *
 * `version` is the fingerprint of the ops this render was folded from. The
 * stream (`/api/board/stream`) sends the current one on connect and whenever
 * it moves; when the two differ, the page is refreshed from the server, which
 * refolds, rejudges and redraws the cards — so a card the agent just dropped
 * crosses to `dropped` a couple of seconds after it says so.
 *
 * Asks for each version once. The refresh brings a new `version` prop with it,
 * and a second event for the same version before that lands must not start a
 * second refresh.
 *
 * Only while the tab is visible. A board in a background tab has nobody to
 * redraw for, and each open stream is a database check every two seconds;
 * coming back reconnects, and the first event it sends catches up.
 *
 * Degrades like the cue panel: EventSource first, which reconnects itself,
 * then plain polling if the stream will not hold.
 */
export function BoardLive({ version }: { version: string }) {
  const router = useRouter();
  const rendered = useRef(version);
  const requested = useRef(version);

  useEffect(() => {
    rendered.current = version;
  }, [version]);

  useEffect(() => {
    let source: EventSource | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let errors = 0;
    let cancelled = false;

    const seen = (latest: string) => {
      if (cancelled || latest === rendered.current || latest === requested.current) return;
      requested.current = latest;
      router.refresh();
    };

    const poll = async () => {
      try {
        const res = await fetch("/api/board/stream", { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const body = (await res.json()) as { version?: string };
        if (typeof body.version === "string") seen(body.version);
      } catch {
        // Offline. The next tick tries again.
      }
    };

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
      void poll();
    };

    const connect = () => {
      if (source || pollTimer || cancelled) return;
      try {
        source = new EventSource("/api/board/stream");
      } catch {
        startPolling();
        return;
      }
      source.addEventListener("version", (event) => {
        errors = 0;
        try {
          const { version: latest } = JSON.parse((event as MessageEvent<string>).data) as { version: string };
          seen(latest);
        } catch {
          // A malformed frame is not worth tearing the stream down for.
        }
      });
      source.onerror = () => {
        errors += 1;
        if (errors >= STREAM_ERRORS_BEFORE_POLLING) {
          source?.close();
          source = undefined;
          startPolling();
        }
      };
    };

    const disconnect = () => {
      source?.close();
      source = undefined;
      clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const onVisibility = () => (document.visibilityState === "visible" ? connect() : disconnect());

    if (document.visibilityState === "visible") connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      disconnect();
    };
  }, [router]);

  return null;
}
