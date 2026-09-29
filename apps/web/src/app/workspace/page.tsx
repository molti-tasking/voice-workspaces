import { X } from "lucide-react";
import type { Metadata } from "next";
import { loadUserDrafts, type WorkspaceDraft } from "@voicemural/db/drafts";
import { listSessionsWithStats } from "@voicemural/db/sessions";
import { boardVersionOf } from "@voicemural/db/board";
import { loadOps } from "@voicemural/db/workspace";
import {
  diffWorkspace,
  foldWorkspace,
  type Block,
  type Topic,
  type WorkspaceState,
} from "@voicemural/workspace";
import { AppDock } from "@/components/app-dock";
import { OpLogLive } from "@/components/op-log-live";
import { Link } from "@/components/nav-link";
import { NavMenu } from "@/components/nav-menu";
import { SurveyHost } from "@/components/survey-host";
import { ViewEvent } from "@/lib/analytics/view-event";
import { parseInstant } from "@/lib/instant";
import { currentUser } from "@/lib/session";
import { CurationProvider, RestoreButton } from "./curation";
import { DraftItem } from "./draft-item";
import { topicIcon } from "./icons";
import { TopicCard } from "./topic-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Workspace",
  robots: { index: false, follow: false },
};

/**
 * The workspace: a balance sheet folded from the transcript ledger.
 *
 * The transcript answers "what did I say, when". This answers "what do I
 * currently think about X" — the question speaking linearly cannot.
 */
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; since?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-fg/60">
          <Link href="/" className="underline">
            Sign in
          </Link>{" "}
          to see your workspace.
        </p>
      </main>
    );
  }

  const { asOf: asOfParam, since: sinceParam } = await searchParams;
  const validAsOf = parseInstant(asOfParam);
  const validSince = parseInstant(sinceParam);

  const [ops, sessions, allDrafts] = await Promise.all([
    loadOps(user.id),
    listSessionsWithStats(user.id, 20),
    loadUserDrafts(user.id),
  ]);

  const state = foldWorkspace(ops, validAsOf);

  // Drafts as of the same moment as the fold, filed on the topic they name.
  // One on a topic that is no longer live (merged away, or never matched)
  // counts as unfiled; one on an ARCHIVED topic goes where the topic went.
  const drafts = allDrafts.filter(
    (d) => !validAsOf || d.createdAt.getTime() <= validAsOf.getTime(),
  );
  const liveTopicIds = new Set(state.topics.map((t) => t.id));
  const archivedTopicIds = new Set(state.archivedTopics.map((t) => t.id));
  const draftsByTopic = new Map<string, WorkspaceDraft[]>();
  const unfiledDrafts: WorkspaceDraft[] = [];
  for (const d of drafts) {
    if (d.archived) continue;
    if (d.topicId && liveTopicIds.has(d.topicId)) {
      draftsByTopic.set(d.topicId, [...(draftsByTopic.get(d.topicId) ?? []), d]);
    } else if (!d.topicId || !archivedTopicIds.has(d.topicId)) {
      unfiledDrafts.push(d);
    }
  }

  // `?since=` turns the page into a diff: what a drive, or a single extraction,
  // actually contributed. Both bounds live in the URL, so "the workspace as it
  // stood after Tuesday" is a link rather than a mode you have to click into.
  const diff = validSince
    ? diffWorkspace(foldWorkspace(ops, validSince), state)
    : undefined;
  const changedBlockIds = diff
    ? new Set([
        ...diff.addedBlocks.map((b) => b.id),
        ...diff.revisedBlocks.map((r) => r.to.id),
      ])
    : undefined;
  /* WHAT IS BEING WORKED ON, FIRST. Every topic ever mentioned was an equal
   * card, and on 28 Sep 2026 the person read eleven of them out and said "all
   * of it is too much for me". Topics touched recently stay as cards; the rest
   * fold into one closed section. Nothing is archived or hidden for good —
   * new talk about an older topic brings it straight back up. Measured from
   * the view's own moment, so `?asOf=` folds as it would have then. */
  const [shownTopics, foldedTopics] = splitByRecency(state.topics, validAsOf);

  const blockCount = [...state.blocksByTopic.values()].reduce(
    (n, b) => n + b.length,
    0,
  );

  return (
    <div className="mx-auto max-w-6xl vm-page-top px-6 pb-40">
      <ViewEvent
        event="workspace_viewed"
        properties={{
          topic_count: state.topics.length,
          block_count: blockCount,
          // Arriving with a diff means the participant followed a timeline
          // marker to see what one extraction produced — the moment they are
          // actually reviewing the model's work.
          has_diff: diff !== undefined,
        }}
      />
      {diff && (
        <>
          <ViewEvent
            event="workspace_diff_viewed"
            properties={{
              added: diff.addedBlocks.length,
              revised: diff.revisedBlocks.length,
              new_topics: diff.addedTopics.length,
            }}
          />
          {/*
            The best moment in the app to ask anything. The participant arrived
            from a timeline marker and is looking at precisely what the model
            made of their own speech, so "is this a fair account?" is answerable
            here and nowhere else — and the answer joins to the generation that
            produced it. Whether anything actually appears is PostHog's call.
          */}
          <SurveyHost sessionsCount={sessions.length} />
        </>
      )}
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Workspace</h1>
          <p className="mt-1 text-sm text-fg/60">
            {state.topics.length} topic{state.topics.length === 1 ? "" : "s"} ·{" "}
            {blockCount} block{blockCount === 1 ? "" : "s"} · folded from{" "}
            {state.opCount} change{state.opCount === 1 ? "" : "s"}
            {validAsOf && (
              <>
                {" "}
                · as of{" "}
                {validAsOf.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </>
            )}
          </p>
        </div>

        <NavMenu />
      </header>

      {diff && (
        // Arrived from a timeline marker. Say plainly what that batch changed,
        // and leave an obvious way back to the whole picture.
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3 text-sm">
          <p className="text-emerald-100">
            <span className="font-medium">Highlighting what changed</span>
            <span className="text-fg/65">
              {" "}
              · {diff.addedBlocks.length} added
              {diff.revisedBlocks.length > 0 &&
                `, ${diff.revisedBlocks.length} revised`}
              {diff.addedTopics.length > 0 &&
                `, ${diff.addedTopics.length} new topic${diff.addedTopics.length === 1 ? "" : "s"}`}
            </span>
          </p>
          <Link
            href={
              validAsOf
                ? `/workspace?asOf=${encodeURIComponent(validAsOf.toISOString())}`
                : "/workspace"
            }
            className="flex items-center gap-1 text-fg/60 hover:text-fg/70"
          >
            <X size={13} aria-hidden />
            Show everything
          </Link>
        </div>
      )}

      <CurationProvider>
      {/* What the agent wrote down during drives that is not filed on a
          topic. First, because it is the thing most likely to have been
          looked for and not found: before this, a draft existed only on the
          live view and the drive's own page. */}
      {unfiledDrafts.length > 0 && (
        <section className="mb-6 rounded-xl border border-[var(--color-line)] p-4">
          {/* Named for what they are. "From your drives" read as a category
              of its own, next to the topics, that nobody could place. */}
          <h2 className="mb-3 text-sm font-medium text-fg/75">
            Drafts not filed on a topic
          </h2>
          <ul className="space-y-1.5">
            {unfiledDrafts.slice(0, 8).map((d) => (
              <DraftItem key={d.id} draft={d} editable={!validAsOf} />
            ))}
          </ul>
        </section>
      )}

      {state.topics.length === 0 && unfiledDrafts.length === 0 ? (
        <EmptyState hasSessions={sessions.length > 0} hasOps={ops.length > 0} />
      ) : state.topics.length === 0 ? null : (
        <>
          <TopicColumns>
            {shownTopics.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                blocks={state.blocksByTopic.get(topic.id) ?? []}
                drafts={draftsByTopic.get(topic.id)}
                allBlocks={state.allBlocks}
                highlight={changedBlockIds}
                editable={!validAsOf}
              />
            ))}
          </TopicColumns>
          {foldedTopics.length > 0 && (
            // Open when a diff highlights something in here, so a marker
            // followed from the timeline never lands on a closed section.
            <details
              className="mt-2 mb-6"
              open={foldedTopics.some((t) =>
                (state.blocksByTopic.get(t.id) ?? []).some((b) => changedBlockIds?.has(b.id)),
              )}
            >
              <summary className="cursor-pointer text-sm text-fg/60 hover:text-fg/80">
                {foldedTopics.length} older topic{foldedTopics.length === 1 ? "" : "s"} · not
                touched in {RECENT_DAYS} days
              </summary>
              <div className="mt-4">
                <TopicColumns>
                  {foldedTopics.map((topic) => (
                    <TopicCard
                      key={topic.id}
                      topic={topic}
                      blocks={state.blocksByTopic.get(topic.id) ?? []}
                      drafts={draftsByTopic.get(topic.id)}
                      allBlocks={state.allBlocks}
                      highlight={changedBlockIds}
                      editable={!validAsOf}
                    />
                  ))}
                </TopicColumns>
              </div>
            </details>
          )}
        </>
      )}

      {!validAsOf && <Archived state={state} drafts={drafts.filter((d) => d.archived)} />}

      {/* Live only when showing now and not a diff: a past moment is a record,
          and a diff is the answer to "what did that batch change", which a
          redraw would move out from under the reader. */}
      {!validAsOf && !diff && (
        <OpLogLive version={boardVersionOf(ops.at(-1)?.seq ?? 0, ops.length)} />
      )}
      </CurationProvider>

      <AppDock />
    </div>
  );
}

/** How recently a topic must have been touched to stay a card up front. */
const RECENT_DAYS = 14;

/**
 * Topics to show as cards, and topics to fold away, as of `asOf` or now.
 *
 * Reads the clock, which is right here — the page is rendered per request
 * (`force-dynamic`) — and is why it is not written inline in the component.
 * Every card goes up front when nothing is recent: a workspace that is only a
 * closed section reads as empty.
 */
function splitByRecency<T extends { lastTouchedAt: Date }>(topics: T[], asOf: Date | undefined): [T[], T[]] {
  const now = asOf?.getTime() ?? Date.now();
  const isRecent = (t: T) => now - t.lastTouchedAt.getTime() <= RECENT_DAYS * 24 * 60 * 60 * 1000;
  const recent = topics.filter(isRecent);
  const older = topics.filter((t) => !isRecent(t));
  return recent.length > 0 ? [recent, older] : [older, []];
}

/**
 * Masonry via CSS columns: cards are wildly uneven in height, and a grid would
 * leave a ragged gap under every short one.
 */
function TopicColumns({ children }: { children: React.ReactNode }) {
  return (
    <div className="columns-1 gap-4 md:columns-2 lg:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
      {children}
    </div>
  );
}

function EmptyState({
  hasSessions,
  hasOps,
}: {
  hasSessions: boolean;
  hasOps: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-line)] p-10 text-center">
      <p className="mb-1 font-medium">Nothing here yet</p>
      <p className="text-sm text-fg/60">
        {!hasSessions ? (
          <>
            Record something first — the workspace is derived from what you say.{" "}
            <Link href="/record" className="underline">
              Start recording
            </Link>
            .
          </>
        ) : hasOps ? (
          "Everything extracted so far has been superseded or retired."
        ) : (
          "Your sessions are transcribed but not yet extracted. The worker picks this up in the background."
        )}
      </p>
    </div>
  );
}

/**
 * What the person archived, out of the way at the bottom and closed by
 * default — but never gone, because an archive that cannot be undone later is
 * a delete, and "I archived the wrong thing last week" is an ordinary moment.
 *
 * Whole topics first, then single items from topics that are still live.
 * Only items the PERSON archived: the extractor retires blocks too, when a
 * later drive contradicts them, and those are revisions, not curation.
 */
function Archived({ state, drafts }: { state: WorkspaceState; drafts: WorkspaceDraft[] }) {
  const liveTopicIds = new Set(state.topics.map((t) => t.id));
  const items: Block[] = [...state.allBlocks.values()]
    .filter(
      (b) =>
        b.retiredAt && b.retiredVia === "user" && !b.supersededById && liveTopicIds.has(b.topicId),
    )
    .sort((a, b) => b.retiredAt!.getTime() - a.retiredAt!.getTime());

  const count = state.archivedTopics.length + items.length + drafts.length;
  if (count === 0) return null;
  const titleOf = (id: string) => state.topics.find((t) => t.id === id)?.title ?? "";

  return (
    <details className="mt-10 rounded-xl border border-[var(--color-line)] p-4">
      <summary className="cursor-pointer text-sm text-fg/65 hover:text-fg">
        Archived ({count})
      </summary>
      <ul className="mt-3 divide-y divide-[var(--color-line)]">
        {state.archivedTopics.map((topic) => (
          <ArchivedRow
            key={topic.id}
            topic={topic}
            detail={`${state.blocksByTopic.get(topic.id)?.length ?? 0} items · archived ${shortDate(topic.retiredAt!)}`}
          >
            <RestoreButton topicId={topic.id} />
          </ArchivedRow>
        ))}
        {items.map((block) => (
          <li key={block.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-fg/75">{block.text}</p>
              <p className="text-xs text-fg/50">
                {titleOf(block.topicId)} · archived {shortDate(block.retiredAt!)}
              </p>
            </div>
            <RestoreButton blockId={block.id} />
          </li>
        ))}
        {drafts.map((draft) => (
          <li key={draft.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-fg/75">{draft.title || "Draft"}</p>
              <p className="text-xs text-fg/50">Draft · {shortDate(draft.createdAt)}</p>
            </div>
            <RestoreButton draftId={draft.id} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function ArchivedRow({
  topic,
  detail,
  children,
}: {
  topic: Topic;
  detail: string;
  children: React.ReactNode;
}) {
  const Icon = topicIcon(topic.icon);
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      {/* eslint-disable-next-line react-hooks/static-components */}
      <Icon size={14} aria-hidden className="shrink-0 text-fg/50" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-fg/80">{topic.title}</p>
        <p className="text-xs text-fg/50">{detail}</p>
      </div>
      {children}
    </li>
  );
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
