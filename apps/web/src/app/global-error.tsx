"use client";

import { useEffect, useRef, useState } from "react";
import { capture } from "@/lib/analytics/client";
import { isChunkLoadError, shouldReload } from "./chunk-recovery";

/**
 * The app's only error boundary.
 *
 * A deploy renames every fingerprinted chunk. A tab left open on the old build
 * then asks for a chunk the server no longer has, throws `ChunkLoadError`, and
 * — with no boundary anywhere before this — went blank, worst of all on
 * `/record` with a phone in a cradle mid-drive. This catches that, reloads once
 * to fetch the current build, and shows a legible fallback for every other
 * error too.
 *
 * `global-error` replaces the root layout when it renders, so it must carry its
 * own `<html>` and `<body>` and cannot use `globals.css`; the styles below are
 * inline for that reason.
 */

/** A second chunk error within this window means the reload did not help. */
const RELOAD_GUARD_MS = 10_000;
const RELOAD_GUARD_KEY = "vm_chunk_reload_at";

type Mode = "reloading" | "stuck" | "error";

interface Plan {
  mode: Mode;
  pathname: string;
}

/**
 * Decide the mode once, without side effects, so it is safe in a state
 * initializer. It reads the reload guard but never writes it; the effect does
 * the writing, the reload and the capture.
 */
function planFor(error: unknown): Plan {
  if (!isChunkLoadError(error)) return { mode: "error", pathname: "" };
  // `global-error` can be server-rendered for a server-side error; the real
  // decision is remade on the client, where `window` exists.
  if (typeof window === "undefined") return { mode: "reloading", pathname: "" };

  const pathname = window.location.pathname;
  let lastReloadAt: number | null = null;
  try {
    const raw = window.sessionStorage.getItem(RELOAD_GUARD_KEY);
    const value = raw === null ? null : Number(raw);
    lastReloadAt = value !== null && Number.isFinite(value) ? value : null;
  } catch {
    // A locked-down WebView throws instead of returning null. Without the guard
    // a reload could loop, so we do not reload at all.
    return { mode: "stuck", pathname };
  }

  const reload = shouldReload({ now: Date.now(), lastReloadAt, guardMs: RELOAD_GUARD_MS });
  return { mode: reload ? "reloading" : "stuck", pathname };
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [plan] = useState<Plan>(() => planFor(error));
  // Fires the capture once per mount, so React's dev double-mount does not
  // report a chunk error twice. Same guard as `lib/analytics/view-event.tsx`.
  const reported = useRef(false);

  useEffect(() => {
    if (plan.mode === "error") return;
    const reloading = plan.mode === "reloading";

    if (!reported.current) {
      reported.current = true;
      // Sent before the reload aborts it, so delivery is best-effort — expect
      // roughly one per chunk error. posthog-js was initialised by
      // instrumentation-client on the first load, independent of this tree.
      capture("chunk_load_recovered", { pathname: plan.pathname, reloaded: reloading });
    }

    if (!reloading) return;

    try {
      window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      /* best-effort: the read in planFor succeeded, so this rarely fails */
    }
    // A short delay lets the recovery event leave first. It is imperceptible
    // next to a page that is already blank.
    const timer = window.setTimeout(() => window.location.reload(), 250);
    return () => window.clearTimeout(timer);
  }, [plan]);

  const copy: Record<
    Mode,
    { heading: string; body: string; action?: { label: string; onClick: () => void } }
  > = {
    reloading: {
      heading: "Updating VoiceMural",
      body: "A new version was just released. Loading it now — your recordings are safe and keep uploading.",
    },
    stuck: {
      heading: "Please reload",
      body: "A new version was released and this tab is out of date. Reload to continue — your recordings are safe and keep uploading.",
      action: { label: "Reload", onClick: () => window.location.reload() },
    },
    error: {
      heading: "Something went wrong",
      body: "The app hit an unexpected problem. Your recordings are safe on this phone and keep uploading.",
      action: { label: "Try again", onClick: () => retry() },
    },
  };
  const view = copy[plan.mode];

  return (
    <html lang="en">
      <body style={bodyStyle}>
        <main style={mainStyle}>
          <h1 style={headingStyle}>{view.heading}</h1>
          <p style={textStyle}>{view.body}</p>
          {view.action && (
            <button type="button" style={buttonStyle} onClick={view.action.onClick}>
              {view.action.label}
            </button>
          )}
        </main>
      </body>
    </html>
  );
}

// Inline styles, because a rendering `global-error` replaces the root layout and
// so never receives `globals.css`. Colours match the app's theme (see the
// `themeColor` and `<body>` background in the root layout).
const bodyStyle: React.CSSProperties = {
  margin: 0,
  minHeight: "100dvh",
  backgroundColor: "#0f1115",
  color: "#ffffff",
  fontFamily:
    "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
};

const mainStyle: React.CSSProperties = {
  maxWidth: "28rem",
  margin: "0 auto",
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  padding: "0 1.5rem",
};

const headingStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 600,
  margin: "0 0 0.75rem",
};

const textStyle: React.CSSProperties = {
  margin: "0 0 2rem",
  color: "rgba(255, 255, 255, 0.6)",
  lineHeight: 1.5,
};

const buttonStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  cursor: "pointer",
  borderRadius: "0.5rem",
  border: "1px solid rgba(255, 255, 255, 0.15)",
  backgroundColor: "rgba(255, 255, 255, 0.05)",
  color: "#ffffff",
  padding: "0.75rem 1.25rem",
  fontWeight: 500,
  fontSize: "1rem",
};
