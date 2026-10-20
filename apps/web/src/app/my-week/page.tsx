import { BookmarkCheck, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, getDb } from "@voicemural/db";
import { user as userTable } from "@voicemural/db/schema";
import { loadWeek, type WeekDrive } from "@voicemural/db/week";
import { localDate, resolveStudyCondition, sparkSelectionOn } from "@voicemural/shared";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * My week: the participant's own last seven days, drive by drive.
 *
 * For each day, who picked what Souffleur's questions were about — Souffleur
 * or them — and for each drive its subjects: the ones they kept in their own
 * head, the ones Souffleur held, and how many questions they pulled on each.
 * It is there so that a week can be remembered with the week in front of
 * them, before the questionnaire (`/survey/week`) and the conversation that
 * follows ask about it — and so that what they kept is never hidden from
 * them. Their own titles, behind their own session; nothing here leaves it.
 */

export const metadata: Metadata = {
  title: "My week",
  robots: { index: false, follow: false },
};

const WEEK_MS = 7 * 86_400_000;

export default async function MyWeekPage() {
  const user = await currentUser();
  if (!user) notFound();

  const timeZone = process.env.STUDY_TIME_ZONE || "UTC";
  const now = new Date();
  const [drives, [template]] = await Promise.all([
    loadWeek(user.id, new Date(now.getTime() - WEEK_MS)),
    getDb()
      .select({ studyCondition: userTable.studyCondition })
      .from(userTable)
      .where(eq(userTable.id, user.id))
      .limit(1),
  ]);
  const condition = resolveStudyCondition(template?.studyCondition).condition;
  const today = condition.sparks ? sparkSelectionOn(condition, now, timeZone) : null;

  const days = byDay(drives, timeZone);
  const subjects = drives.flatMap((d) => d.subjects);
  const kept = subjects.filter((s) => s.kept);
  const byVoice = kept.filter((s) => s.keptVia === "voice").length;

  return (
    <div className="mx-auto max-w-2xl vm-page-top px-6 pb-40">
      <header className="mb-8">
        <p className="mb-2 text-sm font-medium tracking-wide text-fg/60 uppercase">The last seven days</p>
        <h1 className="text-2xl font-semibold">Your week</h1>
        <p className="mt-2 leading-relaxed text-fg/60">
          {drives.length === 0
            ? "No recordings this week yet."
            : `${count(drives.length, "recording")}, ${count(subjects.length, "subject")}. ` +
              (kept.length === 0
                ? "You haven't kept any yet."
                : `You kept ${kept.length}${byVoice > 0 ? `, ${byVoice} of them by voice` : ""}.`)}
        </p>
        {today && (
          <p className="mt-3 rounded-2xl border border-line px-4 py-3 text-sm text-fg/70">
            {today === "chosen"
              ? "Today you pick: tap Keep, or say “keep this one”, for what you want to hold in your own head. Souffleur's questions come for those."
              : "Today Souffleur picks which subjects to ask you about. Nothing to keep."}
          </p>
        )}
      </header>

      <ol className="space-y-8">
        {days.map((day) => (
          <li key={day.date}>
            <h2 className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-base font-medium">{day.label}</span>
              {day.mode && (
                <span className="text-xs tracking-wide text-fg/55 uppercase">
                  {day.mode === "chosen" ? "You picked" : "Souffleur picked"}
                </span>
              )}
            </h2>
            <ul className="space-y-3">
              {day.drives.map((drive) => (
                <li key={drive.id} className="rounded-xl border border-line bg-surface/40 p-4">
                  <Link
                    href={`/sessions/${drive.id}`}
                    className="mb-2 block text-sm text-fg/60 tabular-nums hover:text-fg"
                  >
                    {time(drive.startedAt, timeZone)}
                    {drive.endedAt ? ` · ${minutes(drive)}` : ""}
                  </Link>
                  {drive.subjects.length === 0 ? (
                    <p className="text-sm text-fg/50">No subjects named.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {drive.subjects.map((s) => (
                        <li key={s.ordinal} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className={s.kept ? "font-medium text-fg" : "text-fg/75"}>{s.title}</span>
                          <span className="flex shrink-0 items-center gap-2 text-xs text-fg/55">
                            {s.sparksPulled > 0 && (
                              <span className="flex items-center gap-1" title="Questions you pulled">
                                <Sparkles size={12} aria-hidden />
                                {s.sparksPulled}
                              </span>
                            )}
                            {drive.mode === "chosen" &&
                              (s.kept ? (
                                <span className="flex items-center gap-1 text-fg/80">
                                  <BookmarkCheck size={13} aria-hidden />
                                  Kept{s.keptVia === "voice" ? " by voice" : ""}
                                </span>
                              ) : (
                                <span>Souffleur held</span>
                              ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <p className="mt-10 text-sm text-fg/60">
        At the end of the week:{" "}
        <Link href="/survey/week" className="underline underline-offset-4 hover:text-fg">
          a few questions about how it was to choose
        </Link>
        .
      </p>
    </div>
  );
}

interface Day {
  date: string;
  label: string;
  /** The day's mode, when its drives agree on one. */
  mode: WeekDrive["mode"];
  drives: WeekDrive[];
}

/** Newest day first, each day's drives in the order they happened. */
function byDay(drives: WeekDrive[], timeZone: string): Day[] {
  const days = new Map<string, Day>();
  for (const drive of drives) {
    const date = localDate(drive.startedAt, timeZone);
    const day = days.get(date) ?? {
      date,
      label: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone }).format(
        drive.startedAt,
      ),
      mode: drive.mode,
      drives: [],
    };
    // A pilot override can mix modes within a day; then the day claims none.
    if (day.mode !== drive.mode) day.mode = null;
    day.drives.push(drive);
    days.set(date, day);
  }
  return [...days.values()].reverse();
}

function time(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
}

function minutes(drive: WeekDrive): string {
  const m = Math.max(1, Math.round((drive.endedAt!.getTime() - drive.startedAt.getTime()) / 60_000));
  return `${m} min`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
