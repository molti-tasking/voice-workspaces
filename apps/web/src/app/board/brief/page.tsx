import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { boardEnabledAt } from "@voicemural/db/board";
import { loadOps, loadUtterancesByIds, type TimelineUtterance } from "@voicemural/db/workspace";
import {
  briefBoard,
  foldBoard,
  type BoardCard,
  type CardBrief,
  type TaskState,
  type TopicBrief,
} from "@voicemural/workspace";
import { topicIcon } from "@/app/workspace/icons";
import { AppDock } from "@/components/app-dock";
import { Link } from "@/components/nav-link";
import { NavMenu } from "@/components/nav-menu";
import { ViewEvent } from "@/lib/analytics/view-event";
import { parseInstant } from "@/lib/instant";
import { currentUser } from "@/lib/session";
import { Quotes, Steps, TopicNotes } from "../brief-parts";
import { cardHref, outcomesByBlock, withAsOf } from "../brief-view";
import { markerFor } from "../card-view";

export const dynamic = "force-dynamic";

/** Static for the same reason as the card page: `$pageview` carries the title. */
export const metadata: Metadata = {
  title: "Brief",
  robots: { index: false, follow: false },
};

/**
 * Every active task at once, grouped by topic.
 *
 * The card page answers "what is this task"; this answers "what is on me", and
 * is meant to be read start to finish before beginning a session of work —
 * which is what the board itself cannot do, because a column of sentences says
 * nothing about why any of them is there.
 *
 * Done and dropped cards are left out of the briefs and named in one line per
 * topic instead: they are context, not work. Built from the same fold as
 * `/board`, so the two can never disagree.
 */
export default async function BriefPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const user = await currentUser();
  if (!user) notFound();
  if (!(await boardEnabledAt(user.id))) notFound();

  const { asOf: asOfParam } = await searchParams;
  const asOf = parseInstant(asOfParam);

  const ops = await loadOps(user.id);
  const board = foldBoard(ops, { asOf });
  const topics = briefBoard(board);
  const outcomes = outcomesByBlock(board);

  // One query for the whole page rather than one per card: a brief of twenty
  // tasks is twenty round trips otherwise, and the ids overlap whenever two
  // tasks came out of the same stretch of speech.
  const utterances = await loadUtterancesByIds(
    user.id,
    topics.flatMap((t) => t.cards.flatMap((c) => c.utteranceIds)),
  );
  const byId = new Map(utterances.map((u) => [u.id, u]));

  const cardCount = topics.reduce((n, t) => n + t.cards.length, 0);
  const uncited = topics
    .flatMap((t) => t.cards)
    .filter((c) => !c.utteranceIds.some((id) => byId.has(id))).length;

  return (
    <div className="mx-auto max-w-2xl px-6 pt-10 pb-40">
      <ViewEvent
        event="board_brief_viewed"
        properties={{
          card_count: cardCount,
          topic_count: topics.length,
          uncited,
          has_as_of: asOf !== undefined,
        }}
      />

      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Brief</h1>
          <p className="mt-1 text-sm text-white/40">
            {cardCount} active task{cardCount === 1 ? "" : "s"} across {topics.length} topic
            {topics.length === 1 ? "" : "s"}
            {asOf && (
              <> · as of {asOf.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</>
            )}
          </p>
        </div>

        <NavMenu />
      </header>

      {topics.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line p-10 text-center">
          <p className="mb-1 font-medium">Nothing to brief</p>
          <p className="text-sm text-white/40">
            Every task is done, dropped, or not there yet.{" "}
            <Link href={withAsOf("/board", asOf)} className="underline">
              The board
            </Link>{" "}
            has the finished ones.
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {topics.map((topic) => (
            <TopicSection key={topic.topic.id} topic={topic} byId={byId} asOf={asOf} outcomes={outcomes} />
          ))}
        </div>
      )}

      <nav className="mt-10 text-xs text-white/35">
        <Link href={withAsOf("/board", asOf)} className="hover:text-white/70">
          ← Board
        </Link>
      </nav>

      <AppDock />
    </div>
  );
}

function TopicSection({
  topic,
  byId,
  asOf,
  outcomes,
}: {
  topic: TopicBrief;
  byId: Map<string, TimelineUtterance>;
  asOf?: Date;
  outcomes: ReturnType<typeof outcomesByBlock>;
}) {
  const Icon = topicIcon(topic.topic.icon);
  const finished = topic.tasks.filter((t) => t.state === "done" || t.state === "dropped");

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        {/* Module-level map of Lucide components; see `workspace/topic-card.tsx`. */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon size={15} aria-hidden className="shrink-0 text-white/40" />
        <h2 className="min-w-0 truncate font-medium">{topic.topic.title}</h2>
      </header>

      <div className="mb-4">
        <TopicNotes questions={topic.questions} notes={topic.notes} />
      </div>

      <div className="space-y-5">
        {topic.cards.map((brief) => (
          <CardSection key={brief.card.cardId} brief={brief} byId={byId} asOf={asOf} outcomes={outcomes} />
        ))}
      </div>

      {finished.length > 0 && (
        /* Named but not briefed: a finished task is context for the ones that
           are not, and its quotes would push the live work off the screen. */
        <p className="mt-4 text-[11px] text-white/25">
          Also on this topic: {finishedLabel(finished)} — on{" "}
          <Link href={withAsOf("/board", asOf)} className="underline">
            the board
          </Link>
          .
        </p>
      )}
    </section>
  );
}

/** "2 done, 1 dropped" — the finished tasks counted rather than listed. */
function finishedLabel(tasks: readonly BoardCard[]): string {
  const states: TaskState[] = ["done", "dropped"];
  return states
    .map((state) => ({ state, n: tasks.filter((t) => t.state === state).length }))
    .filter(({ n }) => n > 0)
    .map(({ state, n }) => `${n} ${state}`)
    .join(", ");
}

function CardSection({
  brief,
  byId,
  asOf,
  outcomes,
}: {
  brief: CardBrief;
  byId: Map<string, TimelineUtterance>;
  asOf?: Date;
  outcomes: ReturnType<typeof outcomesByBlock>;
}) {
  const { card } = brief;
  const marker = markerFor(card, outcomes.get(card.lastTransition.blockId));
  const utterances = brief.utteranceIds
    .map((id) => byId.get(id))
    .filter((u): u is TimelineUtterance => u !== undefined);

  return (
    <article className="rounded-xl border border-line bg-ink-soft/40 p-4">
      <Link
        href={cardHref(card.cardId, asOf)}
        /* The label is the task's own words, and PostHog autocapture sends the
           text of whatever was clicked. */
        className="ph-no-capture text-sm leading-snug hover:underline"
      >
        {card.block.text}
      </Link>

      <p className="mt-1 font-mono text-[10px] text-white/30">
        {card.state}
        {marker && <> · {marker}</>}
      </p>

      <div className="mt-3">
        <Quotes brief={brief} utterances={utterances} />
      </div>

      {/* Collapsed, because on this page the history is the second question:
          "what is on me" is answered by the task and the quote, and "how did
          this get here" is asked of one card at a time. */}
      <details className="mt-3">
        <summary className="cursor-pointer list-none text-[10px] text-white/25 hover:text-white/60">
          {brief.steps.length} step{brief.steps.length === 1 ? "" : "s"}
        </summary>
        <div className="mt-2">
          <Steps brief={brief} />
        </div>
      </details>
    </article>
  );
}
