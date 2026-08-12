"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which is what makes the app installable.
 *
 * Development is excluded on purpose: a worker that survives a dev server
 * restart serves assets from a build that no longer exists, and the symptom is
 * a blank page with a chunk-load error rather than anything that points at the
 * worker. An already-registered worker from a previous production visit to the
 * same origin (localhost, typically) is unregistered here for the same reason.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => void r.unregister()));
      return;
    }

    // Registration competes with the recorder's first paint for bandwidth on a
    // phone that has just woken up, and nothing on screen depends on it.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
