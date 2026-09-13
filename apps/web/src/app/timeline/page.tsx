import type { Metadata } from "next";
import {
  loadSessionUtterances,
  loadTimelineMarkers,
  loadTimelineSessions,
  loadTimelineAgentTurns,
} from "@voicemural/db/workspace";
import { AppDock } from "@/components/app-dock";
import { Link } from "@/components/nav-link";
import { NavMenu } from "@/components/nav-menu";
import { ViewEvent } from "@/lib/analytics/view-event";
import { currentUser } from "@/lib/session";
import { ScrollToLatest } from "./scroll-to-latest";
import { SessionBlock } from "./session-block";
import { LoadMoreSentinel } from "./timeline-scroller";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Timeline",
  robots: { index: false, follow: false },
};

/** Sessions rendered per page. One drive is ~200 utterances. */
const PAGE_SIZE = 3;

/**
 * Hard ceiling on ?sessions=. The page runs one utterances query per session
 * and renders the whole result — on a phone, hundreds of drives is ~100k rows
 * of RSC output — so an unbounded value here is a self-inflicted outage, not
 * a display preference. 50 drives is already more than anyone reads inline.
 */
const MAX_SESSIONS = 50;

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
  const shown =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_SESSIONS)
      : PAGE_SIZE;

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

  const [utterancesBySession, agentTurns] = await Promise.all([
    Promise.all(visible.map((s) => loadSessionUtterances(user.id, s.id))),
    // One query for every drive rather than one per drive: turns are few, and
    // the page already runs an utterance query per session.
    loadTimelineAgentTurns(user.id),
  ]);

  const latest = allSessions[allSessions.length - 1]!;

  return (
    // Bottom padding clears the dock and its scrim: the timeline's last line
    // is the most-recent utterance, and reading it half-covered by the record
    // button is the one thing this page must not do.
    <div className="mx-auto max-w-3xl px-6 pt-10 pb-40">
      <ScrollToLatest targetId={`session-${latest.id}`} />
      <ViewEvent
        event="timeline_viewed"
        properties={{
          session_count: allSessions.length,
          marker_count: markers.length,
        }}
      />
      {shown > PAGE_SIZE && (
        // Paging in earlier drives is the one real interaction on this page,
        // and it no longer shows up as a pageview now that capture is keyed on
        // pathname alone.
        <ViewEvent
          event="timeline_page_loaded"
          properties={{ sessions_shown: shown }}
        />
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

        <NavMenu />
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
            agentTurns={agentTurns.filter(
              (t) => t.captureSessionId === session.id,
            )}
          />
        ))}
      </div>

      <AppDock />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      {/* Someone with nothing recorded is exactly who most needs the account
          control — it is the guest who has not signed in yet. */}
      <div className="mb-6 flex justify-end">
        <NavMenu />
      </div>
      <h1 className="mb-2 text-2xl font-semibold">Timeline</h1>
      <p className="text-sm text-white/40">
        Nothing recorded yet.{" "}
        <Link href="/record" className="underline">
          Start recording
        </Link>{" "}
        and your drives will appear here in order.
      </p>
      {/* Someone with nothing recorded is precisely who the record button is
          for, so the dock belongs here more than anywhere. */}
      <AppDock />
    </div>
  );
}
