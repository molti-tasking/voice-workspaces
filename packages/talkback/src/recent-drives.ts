import { isTimeZone } from "./clock";

/**
 * The person's last few drives, by name, as a section of the agent's prompt.
 *
 * "What did we discuss last time?" (14 Oct 2026) got "I can't see a transcript
 * from a previous drive" — thirteen minutes after a drive the app had already
 * named "User Interface". Recall searches the ledger for the words of a
 * question, and "last time" has none worth matching; WHERE THINGS STAND holds
 * topics, not drives. So the session carries the drives themselves: their
 * names (`capture_session.title`, which `TopicTitle` keeps), when, and how
 * long. Names only — what was said is still recall's business, and the
 * section says so, because a name is a strong invitation to invent the rest.
 *
 * In the session prompt rather than the turn context: it does not change
 * during a drive, and a turn context is paid for on every turn.
 *
 * Pure, and free of @voicemural/db, like `screen.ts`.
 */

export interface RecentDrive {
  title: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

/** How many earlier drives the agent is shown. */
export const RECENT_DRIVES_SHOWN = 5;

const DAY_MS = 86_400_000;

/** The section, or null when there is no earlier drive to show. */
export function renderRecentDrives(
  drives: readonly RecentDrive[],
  now: Date,
  timeZone?: string | null,
): string | null {
  if (drives.length === 0) return null;
  const known = isTimeZone(timeZone);
  const zone = known ? timeZone : "UTC";
  // en-CA formats a date as YYYY-MM-DD, which compares as a calendar day.
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: zone });
  const today = day(now);
  const yesterday = day(new Date(now.getTime() - DAY_MS));

  const lines = drives.slice(0, RECENT_DRIVES_SHOWN).map((drive) => {
    const date = day(drive.startedAt);
    const when =
      date === today
        ? "today"
        : date === yesterday
          ? "yesterday"
          : drive.startedAt.toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: zone,
            });
    const time = drive.startedAt.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: zone,
    });
    const minutes = drive.endedAt
      ? Math.max(1, Math.round((drive.endedAt.getTime() - drive.startedAt.getTime()) / 60_000))
      : null;
    const name = drive.title?.trim() ? `"${drive.title.trim()}"` : "an unnamed drive";
    return `- ${name}, ${when} at ${time}${minutes ? `, ${minutes} min` : ""}`;
  });

  return [
    "EARLIER DRIVES: their recordings before this one, newest first, each by the name it was given from what was said in it. You have the names, not the words.",
    ...lines,
    `When they ask what you talked about last time, answer from this list: say which drive and when. What was said in it is only what you are shown elsewhere — WHERE THINGS STAND, or quotes from earlier drives — so never fill a name in with detail you were not given.${known ? "" : " The times are UTC."}`,
  ].join("\n");
}
