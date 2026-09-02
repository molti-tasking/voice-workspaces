import type { Metadata } from "next";
import { Link } from "@/components/nav-link";
import { LayoutGrid, Mic, Waypoints } from "lucide-react";
import {
  loadSessionUtterances,
  loadTimelineMarkers,
  loadTimelineSessions,
} from "@voicemural/db/workspace";
import { AccountMenu } from "@/components/account-menu";
import { currentUser } from "@/lib/session";
import { ScrollToLatest } from "./scroll-to-latest";
import { SessionBlock } from "./session-block";
import { LoadMoreSentinel } from "./timeline-scroller";
import { ViewEvent } from "@/lib/analytics/view-event";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Timeline",
  robots: { index: false, follow: false },
};

/** Sessions rendered per page. One drive is ~200 utterances. */
const PAGE_SIZE = 3;

/**
 * The ledger, read end to end.
 *
 * Every utterance across every drive on one continuous scroll, **oldest
 * first** — scrolling down moves forward in time, the way a journal reads.
 * Workspace markers sit inline at the point where each extraction consumed its
 * last utterance, so the balance-sheet snapshots appear inside the speech that
 * produced them.
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ sessions?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-white/60">
          <Link href="/" className="underline">
            Sign in
          </Link>{" "}
          to see your timeline.
        </p>
      </main>
    );
  }

  const { sessions: sessionsParam } = await searchParams;
  const requested = Number(sessionsParam);
  const shown = Number.isFinite(requested) && requested > 0 ? requested : PAGE_SIZE;

  const [allSessions, markers] = await Promise.all([
    loadTimelineSessions(user.id),
    loadTimelineMarkers(user.id),
  ]);

  if (allSessions.length === 0) {
    return <EmptyState />;
  }

  // Oldest first, but page from the RECENT end: someone opening the timeline
  // wants this week, and five weeks of commutes should not have to load before
  // they can see it. The slice is then re-sorted so the page still reads
  // forwards.
  const visible = allSessions.slice(Math.max(0, allSessions.length - shown));
  const hasEarlier = visible.length < allSessions.length;

  const utterancesBySession = await Promise.all(
    visible.map((s) => loadSessionUtterances(user.id, s.id)),
  );

  const latest = allSessions[allSessions.length - 1]!;

  return (
    <div className="mx-auto max-w-3xl px-6 pt-10 pb-28">
      <ScrollToLatest targetId={`session-${latest.id}`} />
      <ViewEvent
        event="timeline_viewed"
        properties={{ session_count: allSessions.length, marker_count: markers.length }}
      />
      {shown > PAGE_SIZE && (
        // Paging in earlier drives is the one real interaction on this page,
        // and it no longer shows up as a pageview now that capture is keyed on
        // pathname alone.
        <ViewEvent event="timeline_page_loaded" properties={{ sessions_shown: shown }} />
      )}

      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Timeline</h1>
          <p className="mt-1 text-sm text-white/40">
            {allSessions.length} drive{allSessions.length === 1 ? "" : "s"} ·{" "}
            {markers.filter((m) => m.opCount > 0).length} workspace update
            {markers.filter((m) => m.opCount > 0).length === 1 ? "" : "s"}
          </p>
        </div>

        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/workspace"
            className="flex items-center gap-1.5 text-white/40 underline-offset-4 hover:underline"
          >
            <LayoutGrid size={14} aria-hidden />
            Workspace
          </Link>
          <Link
            href="/trajectory"
            className="flex items-center gap-1.5 text-white/40 underline-offset-4 hover:underline"
          >
            <Waypoints size={14} aria-hidden />
            Trajectory
          </Link>
          <AccountMenu />
        </nav>
      </header>

      {/* Oldest first means earlier drives load upward, above what is on screen. */}
      {hasEarlier && <LoadMoreSentinel nextCount={shown + PAGE_SIZE} />}

      <div className="space-y-10">
        {visible.map((session, i) => (
          <SessionBlock
            key={session.id}
            session={session}
            utterances={utterancesBySession[i] ?? []}
            markers={markers.filter(
              (m) =>
                m.occurredAt >= session.startedAt &&
                m.occurredAt <= (session.endedAt ?? new Date(8.64e15)),
            )}
          />
        ))}
      </div>

      <TimelineActions />
    </div>
  );
}

/**
 * Where to go next, at the bottom of the page.
 *
 * The timeline reads forwards, so the reader finishes at the most recent drive
 * — which is exactly where "and now?" gets asked. Fixed rather than in the
 * header for the same reason.
 */
function TimelineActions() {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-[var(--color-ink)] via-[var(--color-ink)]/90 to-transparent pt-10 pb-6">
      <nav className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-ink-soft)]/90 p-1.5 shadow-2xl backdrop-blur">
        <Link
          href="/workspace"
          className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"
        >
          <LayoutGrid size={15} aria-hidden />
          Workspace
        </Link>
        <Link
          href="/record"
          className="flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Mic size={15} aria-hidden />
          Record
        </Link>
      </nav>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      {/* Someone with nothing recorded is exactly who most needs the account
          control — it is the guest who has not signed in yet. */}
      <div className="mb-6 flex justify-end">
        <AccountMenu />
      </div>
      <h1 className="mb-2 text-2xl font-semibold">Timeline</h1>
      <p className="text-sm text-white/40">
        Nothing recorded yet.{" "}
        <Link href="/record" className="underline">
          Start recording
        </Link>{" "}
        and your drives will appear here in order.
      </p>
    </div>
  );
}
