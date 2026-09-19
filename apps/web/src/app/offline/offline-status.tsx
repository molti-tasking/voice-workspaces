"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * `navigator.onLine`, as an external store rather than effect-managed state.
 *
 * Connectivity is a platform API that changes underneath React, which is
 * precisely what `useSyncExternalStore` is for — and it gives the pre-hydration
 * value for free through the third argument.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const currentlyOnline = () => navigator.onLine;

/**
 * Null until hydrated: this page is prerendered into the precached document,
 * where `navigator` does not exist, and guessing would render the wrong
 * sentence for the moment before hydration corrects it.
 */
const unknownUntilHydrated = () => null;

/**
 * Narrows "we could not load the page" to something the reader can act on.
 *
 * The worker serves this page whenever a navigation's `fetch` rejects, and a
 * rejected fetch is not the same thing as a lost signal: a blocked request — a
 * Safe Browsing interstitial, an extension, a corporate DNS filter — a TLS
 * failure and a server that dropped the connection all land here too. Telling
 * someone with four bars of 5G that they are probably in a tunnel sends them
 * looking for the fault in the one place it cannot be, which is exactly what
 * happened to the first person who hit this.
 *
 * Progressive enhancement on purpose: the markup in `page.tsx` is already true
 * on its own, because this page is precached and its scripts are the first
 * thing a stale cache loses. Everything here only sharpens it.
 */
export function OfflineStatus() {
  const online = useSyncExternalStore(
    subscribe,
    currentlyOnline,
    unknownUntilHydrated,
  );

  useEffect(() => {
    // Coming back into signal is the common case, and someone who has just
    // parked should not have to work out that they need to pull to refresh.
    const reload = () => window.location.reload();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, []);

  return (
    <div className="mb-8">
      {online !== null && (
        <p className="mb-4 text-white/60">
          {online ? (
            <>
              Your phone{" "}
              <strong className="font-medium text-white">does</strong> have a
              connection, so this is not the signal. Either VoiceMural is down
              for a moment, or something on this network or browser is blocking
              the site.
            </>
          ) : (
            <>This phone has no connection at all right now.</>
          )}
        </p>
      )}
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="cursor-pointer rounded-lg border border-line bg-ink-soft px-5 py-3 font-medium text-white hover:bg-white/10"
      >
        Try again
      </button>
    </div>
  );
}
