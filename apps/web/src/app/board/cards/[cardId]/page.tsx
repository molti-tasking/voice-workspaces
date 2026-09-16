import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { boardEnabledAt } from "@voicemural/db/board";
import { loadOps, loadUtterancesByIds } from "@voicemural/db/workspace";
import { briefCard, cardFor, foldBoard, topicContext } from "@voicemural/workspace";
import { topicIcon } from "@/app/workspace/icons";
import { AppDock } from "@/components/app-dock";
import { Link } from "@/components/nav-link";
import { NavMenu } from "@/components/nav-menu";
import { ViewEvent } from "@/lib/analytics/view-event";
import { parseInstant } from "@/lib/instant";
import { currentUser } from "@/lib/session";
import { Quotes, Steps, TopicNotes } from "../../brief-parts";
import { cardHref, outcomesByBlock, withAsOf } from "../../brief-view";
import { markerFor } from "../../card-view";

export const dynamic = "force-dynamic";

/**
 * Static, and it must stay static.
 *
 * PostHog's `$pageview` carries `document.title`, so a title built from the
 * task would ship the participant's own words to an analytics vendor as the
 * name of a page. The same reason `board_card_viewed` carries ids and counts
 * and nothing else.
 */
export const metadata: Metadata = {
  title: "Task",
  robots: { index: false, follow: false },
};

/**
 * One task, with everything the record already knows about it.
 *
 * A card on `/board` is a sentence and a marker line, which is enough to
 * recognise a task and not enough to start on one. This is the rest: what was
 * said, in the person's own words and dated; every step the card took and who
 * took it; and what else is open on the topic it belongs to.
 *
 * Nothing here is generated. No model runs, nothing is stored, and the page is
 * a fourth read of the same op log — so it cannot disagree with the board, the
 * workspace or the trajectory about what happened. It also means the page works
 * against `pnpm db:fixtures` with no API key, which is the point.
 *
 * A server component throughout: what it renders is the participant's speech,
 * and none of it belongs in a client payload.
 */
export default async function CardBriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<{ asOf?: string }>;
}) {
  const user = await currentUser();
  if (!user) notFound();
  if (!(await boardEnabledAt(user.id))) notFound();

  const { cardId } = await params;
  const { asOf: asOfParam } = await searchParams;
  const asOf = parseInstant(asOfParam);

  const ops = await loadOps(user.id);
  const board = foldBoard(ops, { asOf });

  // Resolves an old block id to the live card, so a link minted before a move
  // still opens. Retired, non-task and unknown ids fall through to a 404 —
  // including a card that did not yet exist at `asOf`.
  const card = cardFor(board, cardId);
  if (!card) notFound();

  const brief = briefCard(board, card);
  const context = topicContext(board, card.topic);
  const utterances = await loadUtterancesByIds(user.id, brief.utteranceIds);
  const marker = markerFor(card, outcomesByBlock(board).get(card.lastTransition.blockId));
  const others = context.tasks.filter((t) => t.cardId !== card.cardId);

  const Icon = topicIcon(card.topic.icon);

  return (
    <div className="mx-auto max-w-2xl px-6 pt-10 pb-40">
      <ViewEvent
        event="board_card_viewed"
        properties={{
          card_id: card.cardId,
          state: card.state,
          utterance_count: utterances.length,
          step_count: brief.steps.length,
          stale_sessions: card.staleSessions,
          has_as_of: asOf !== undefined,
        }}
      />

      <header className="mb-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-white/40">
            {/*
              `topicIcon` selects from a module-level map of Lucide components,
              so the identity is stable for a given name; the rule cannot see
              through the lookup. Same as `workspace/topic-card.tsx`.
            */}
            {/* eslint-disable-next-line react-hooks/static-components */}
            <Icon size={13} aria-hidden className="shrink-0" />
            <span className="truncate">{card.topic.title}</span>
          </p>
          <NavMenu />
        </div>

        <h1 className="text-xl leading-snug font-medium">{card.block.text}</h1>

        <p className="mt-2 font-mono text-[11px] text-white/35">
          {card.state}
          {marker && <> · {marker}</>}
          {asOf && <> · as of {asOf.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</>}
        </p>
      </header>

      <div className="space-y-8">
        <Section title="What you said">
          <Quotes brief={brief} utterances={utterances} />
        </Section>

        <Section title="How it moved">
          <Steps brief={brief} />
        </Section>

        <Section title="On this topic">
          <div className="space-y-4">
            <TopicNotes questions={context.questions} notes={context.notes} />

            {others.length > 0 && (
              <ul className="space-y-1.5 border-t border-line pt-3">
                {others.map((task) => (
                  <li key={task.cardId} className="flex items-baseline gap-2 text-sm">
                    <Link
                      href={cardHref(task.cardId, asOf)}
                      /* The label is the task's own words, and PostHog
                         autocapture sends the text of whatever was clicked. */
                      className="ph-no-capture min-w-0 flex-1 leading-snug hover:underline"
                    >
                      {task.state === "dropped" ? (
                        <span className="text-white/30 line-through">{task.block.text}</span>
                      ) : (
                        <span className={task.state === "done" ? "text-white/40" : ""}>
                          {task.block.text}
                        </span>
                      )}
                    </Link>
                    <span className="shrink-0 font-mono text-[10px] text-white/25">
                      {task.state}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {context.questions.length === 0 &&
              context.notes.length === 0 &&
              others.length === 0 && (
                <p className="text-sm text-white/35">
                  Nothing else has been said about this topic yet.
                </p>
              )}
          </div>
        </Section>
      </div>

      <nav className="mt-10 flex gap-4 text-xs text-white/35">
        <Link href={withAsOf("/board", asOf)} className="hover:text-white/70">
          ← Board
        </Link>
        <Link href={withAsOf("/board/brief", asOf)} className="hover:text-white/70">
          All briefs
        </Link>
      </nav>

      <AppDock />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-white/50">{title}</h2>
      {children}
    </section>
  );
}
