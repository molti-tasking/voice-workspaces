"use client";

/**
 * A date as the reader's own device writes it: their language, their time
 * zone. Server-rendered pages would otherwise print the server's.
 *
 * "12 Sep" this year, "12 Sep 2025" before it, and a time only when asked for
 * — entries in the workspace are dated so people can tell when they said
 * something (the pilot: "there's no date on it"), not to timestamp them.
 *
 * The server's rendering can differ from the browser's by time zone, and that
 * difference is expected rather than a bug, so the hydration warning is
 * suppressed on this one element.
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
  const d = typeof date === "string" ? new Date(date) : date;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const text = d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
  return (
    <time dateTime={d.toISOString()} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
