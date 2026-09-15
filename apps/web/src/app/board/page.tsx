import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { boardEnabledAt } from "@voicemural/db/board";
import { loadOps } from "@voicemural/db/workspace";
import { KEPT_AFTER_SESSIONS, foldBoard, judge } from "@voicemural/workspace";
import { AppDock } from "@/components/app-dock";
import { Link } from "@/components/nav-link";
import { NavMenu } from "@/components/nav-menu";
import { ViewEvent } from "@/lib/analytics/view-event";
import { parseInstant } from "@/lib/instant";
import { currentUser } from "@/lib/session";
import { BoardSurface } from "./board-surface";
import { toCardView } from "./card-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Board",
  robots: { index: false, follow: false },
};

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
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-40">
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

        <NavMenu />
      </header>

      {board.cards.length === 0 ? (
        <EmptyState hasOps={ops.length > 0} />
      ) : (
        /* The fold stays here. `BoardSurface` is a client component because a
           drop target and an optimistically-moved card are one piece of state,
           but what crosses is `CardView[]` — no revision history, no blocks,
           no transitions. Columns are rebuilt from `state` on the other side. */
        <BoardSurface
          cards={board.cards.map((card) =>
            toCardView(card, outcomeByBlock.get(card.lastTransition.blockId)),
          )}
        />
      )}

      <AppDock />
    </div>
  );
}

function EmptyState({ hasOps }: { hasOps: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-10 text-center">
      <p className="mb-1 font-medium">Nothing on the board yet</p>
      <p className="text-sm text-white/40">
        {hasOps
          ? "Tasks appear here when you say you will do something — \"I need to email William tomorrow\" — and move when you say how it went."
          : "The board is derived from what you say. Record something first."}
      </p>
    </div>
  );
}
