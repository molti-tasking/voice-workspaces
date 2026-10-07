/**
 * What time it is where they are, as one line of turn context.
 *
 * Nothing told the agent the time of day. On 7 Oct 2026, asked "what time is
 * it now?" at about 10:00 in Copenhagen, it said "It's 10:14 AM" — and again,
 * word for word, when asked a second time — and then went silent when told it
 * was wrong. The only date anywhere in the prompt was the web search section's,
 * in UTC.
 *
 * The zone is the browser's own (`deviceInfo.timeZone`, sent when the drive is
 * registered), so it follows the person rather than the server. When it is not
 * known the line says UTC out loud, so the model never passes UTC off as their
 * local time.
 *
 * Pure, and free of @voicemural/db.
 */

/** Whether `value` is an IANA zone this runtime can format in. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone a drive was recorded in, from its stored `device_info`, or null. */
export function timeZoneOf(deviceInfo: unknown): string | null {
  const zone = (deviceInfo as { timeZone?: unknown } | null)?.timeZone;
  return isTimeZone(zone) ? zone : null;
}

/** The date in `timeZone` (UTC when unknown), as "Wednesday, 7 October 2026". */
export function localDate(now: Date, timeZone?: string | null): string {
  return now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: isTimeZone(timeZone) ? timeZone : "UTC",
  });
}

/**
 * The line for the turn context. Rendered when their words arrive, so it is
 * the time as of what was just said — which is when a question about the time
 * is asked.
 */
export function renderLocalTime(now: Date, timeZone?: string | null): string {
  const known = isTimeZone(timeZone);
  const zone = known ? timeZone : "UTC";
  const time = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  });
  const when = `${localDate(now, zone)}, ${time}`;
  return known
    ? `LOCAL TIME: ${when} (${zone}).`
    : `LOCAL TIME: ${when} UTC. Their own time zone is not known: if you give the time, say it is UTC.`;
}
