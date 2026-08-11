import { Link } from "@/components/nav-link";
import { ListTree, X } from "lucide-react";
import { loadOps } from "@voicemural/db/workspace";
import { listSessionsWithStats } from "@voicemural/db/sessions";
import { diffWorkspace, foldWorkspace } from "@voicemural/workspace";
import { AccountMenu } from "@/components/account-menu";
import { currentUser } from "@/lib/session";
import { TopicCard } from "./topic-card";
import { ViewEvent } from "@/lib/analytics/view-event";
import { SurveyHost } from "@/components/survey-host";

export const dynamic = "force-dynamic";

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
        <p className="text-white/60">
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

  const [ops, sessions] = await Promise.all([
    loadOps(user.id),
    listSessionsWithStats(user.id, 20),
  ]);

  const state = foldWorkspace(ops, validAsOf);

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
  const blockCount = [...state.blocksByTopic.values()].reduce(
    (n, b) => n + b.length,
    0,
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
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
          <p className="mt-1 text-sm text-white/40">
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

        <nav className="flex items-center gap-4 text-sm">
          <Link
            href="/timeline"
            className="flex items-center gap-1.5 text-white/40 underline-offset-4 hover:underline"
          >
            <ListTree size={14} aria-hidden />
            Timeline
          </Link>
          <Link
            href="/"
            className="text-white/40 underline-offset-4 hover:underline"
          >
            Sessions
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

      {diff && (
        // Arrived from a timeline marker. Say plainly what that batch changed,
        // and leave an obvious way back to the whole picture.
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-4 py-3 text-sm">
          <p className="text-emerald-100">
            <span className="font-medium">Highlighting what changed</span>
            <span className="text-white/50">
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
            className="flex items-center gap-1 text-white/40 hover:text-white/70"
          >
            <X size={13} aria-hidden />
            Show everything
          </Link>
        </div>
      )}

      {state.topics.length === 0 ? (
        <EmptyState hasSessions={sessions.length > 0} hasOps={ops.length > 0} />
      ) : (
        // Masonry via CSS columns: cards are wildly uneven in height, and a grid
        // would leave a ragged gap under every short one.
        <div className="columns-1 gap-4 md:columns-2 lg:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {state.topics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              blocks={state.blocksByTopic.get(topic.id) ?? []}
              allBlocks={state.allBlocks}
              highlight={changedBlockIds}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A query param to an instant, or undefined for anything unparseable. */
function parseInstant(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
      <p className="text-sm text-white/40">
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
