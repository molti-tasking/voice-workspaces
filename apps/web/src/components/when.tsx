"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * A date as the reader's own device writes it: their language, their time
 * zone. Server-rendered pages would otherwise print the server's.
 *
 * "12 Sep" this year, "12 Sep 2025" before it, and a time only when asked for
 * — entries in the workspace are dated so people can tell when they said
 * something (the pilot: "there's no date on it"), not to timestamp them.
 *
 * Empty until hydrated. The server's rendering differs from the browser's
 * whenever their locale or time zone do, and `suppressHydrationWarning` only
 * hides that: React keeps the server's text, so the reader would see the
 * server's time zone. `useSyncExternalStore` renders the empty server snapshot
 * during hydration too, then formats in the browser.
 */
export function When({
  date,
  withTime = false,
  className,
}: {
  date: Date | string;
  withTime?: boolean;
  className?: string;
}) {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const d = typeof date === "string" ? new Date(date) : date;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const text = d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
  return (
    <time dateTime={d.toISOString()} className={className}>
      {inBrowser ? text : null}
    </time>
  );
}
