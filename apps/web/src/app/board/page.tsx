import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LayoutGrid, ListTree, Sparkles, Waypoints } from "lucide-react";
import { boardEnabledAt } from "@voicemural/db/board";
import { loadOps } from "@voicemural/db/workspace";
import { TaskState, foldBoard, judge } from "@voicemural/workspace";
import { AccountMenu } from "@/components/account-menu";
import { Link } from "@/components/nav-link";
import { ViewEvent } from "@/lib/analytics/view-event";
import { parseInstant } from "@/lib/instant";
import { currentUser } from "@/lib/session";
import { BoardCard } from "./board-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Board",
  robots: { index: false, follow: false },
};

/**
 * How many later drives a speech-driven move must survive untouched to count
 * as kept. Two: one commute is easy to miss; two is a choice.
 */
const KEPT_AFTER_SESSIONS = 2;

/**
 * The task board: what the person has said they would do, by tense.
 *
 * A third fold over the same op log as `/workspace` and `/trajectory`. The
 * columns are the tenses of speech — open, next, doing, done, dropped — and
 * spoken progress moves cards between them through the extractor. The person
 * can move a card too, and the difference between the two is the measurement.
 *
 * Hidden until `user.board_enabled_at` is set, so the study has a before and an
 * after per participant.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-white/60">
          <Link href="/" className="underline">
            Sign in
          </Link>{" "}
          to see your board.
        </p>
      </main>
    );
  }

  if (!(await boardEnabledAt(user.id))) notFound();

  const { asOf: asOfParam } = await searchParams;
  const asOf = parseInstant(asOfParam);

  const ops = await loadOps(user.id);
  const board = foldBoard(ops, { asOf });
  const outcomes = judge(board.transitions, {
    withinSessions: KEPT_AFTER_SESSIONS,
    sessions: board.sessions,
  });
  // The verdict on each card's latest speech move, keyed by the block that
  // carried it, so the card can say "kept" once it is.
  const outcomeByBlock = new Map(outcomes.map((o) => [o.transition.blockId, o]));
  const awaitingReview = board.cards.filter(
    (c) => outcomeByBlock.get(c.lastTransition.blockId)?.outcome === "pending",
  ).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <ViewEvent
        event="board_viewed"
        properties={{
          card_count: board.cards.length,
          open: board.columns.open.length,
          next: board.columns.next.length,
          doing: board.columns.doing.length,
          done: board.columns.done.length,
          dropped: board.columns.dropped.length,
          awaiting_review: awaitingReview,
        }}
      />

      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Board</h1>
          <p className="mt-1 text-sm text-white/40">
            {board.cards.length} task{board.cards.length === 1 ? "" : "s"} ·{" "}
            {board.transitions.length} move{board.transitions.length === 1 ? "" : "s"}
            {awaitingReview > 0 && ` · ${awaitingReview} moved by speech, not yet reviewed`}
            {asOf && (
              <> · as of {asOf.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</>
            )}
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
          <Link
            href="/repertoire"
            className="flex items-center gap-1.5 text-white/40 underline-offset-4 hover:underline"
          >
            <Sparkles size={14} aria-hidden />
            Repertoire
          </Link>
          <Link
            href="/timeline"
            className="flex items-center gap-1.5 text-white/40 underline-offset-4 hover:underline"
          >
            <ListTree size={14} aria-hidden />
            Timeline
          </Link>
          <Link
            href="/record"
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 font-medium text-white"
          >
            Record
          </Link>
          <AccountMenu />
        </nav>
      </header>

      {board.cards.length === 0 ? (
        <EmptyState hasOps={ops.length > 0} />
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          {TaskState.options.map((state) => (
            <section key={state} className="min-w-0">
              <h2 className="mb-2 flex items-baseline gap-2 text-[11px] tracking-wide text-white/30 uppercase">
                {state}
                <span className="font-mono text-[10px] text-white/20">
                  {board.columns[state].length}
                </span>
              </h2>
              <div className="space-y-3">
                {board.columns[state].map((card) => (
                  <BoardCard
                    key={card.cardId}
                    card={card}
                    outcome={outcomeByBlock.get(card.lastTransition.blockId)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasOps }: { hasOps: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-line)] p-10 text-center">
      <p className="mb-1 font-medium">Nothing on the board yet</p>
      <p className="text-sm text-white/40">
        {hasOps
          ? "Tasks appear here when you say you will do something — \"I need to email William tomorrow\" — and move when you say how it went."
          : "The board is derived from what you say. Record something first."}
      </p>
    </div>
  );
}
