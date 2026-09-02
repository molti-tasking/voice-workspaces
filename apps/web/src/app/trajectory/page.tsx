import type { Metadata } from "next";
import { ArrowRight, LayoutGrid, ListTree } from "lucide-react";
import { Link } from "@/components/nav-link";
import { loadOps } from "@voicemural/db/workspace";
import { buildTrajectory } from "@voicemural/workspace";
import { AccountMenu } from "@/components/account-menu";
import { currentUser } from "@/lib/session";
import { ViewEvent } from "@/lib/analytics/view-event";
import { topicIcon } from "@/app/workspace/icons";
import { Stream } from "./stream";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trajectory",
  robots: { index: false, follow: false },
};

/**
 * How the thinking moved.
 *
 * `/workspace` folds the op log to one moment and shows what is currently
 * thought. This folds it to every moment and shows the shape that makes: which
 * topics grew, which were revised, which were finished with, and when.
 *
 * Built entirely from `loadOps` + `buildTrajectory`, which is `foldWorkspace`
 * in a loop. There is no stored trajectory and no second source of truth, so
 * this page cannot disagree with the workspace it links into — and everything
 * it links to is a URL that already worked.
 */
export default async function TrajectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string; bucket?: string }>;
}) {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-white/60">
          <Link href="/" className="underline">
            Sign in
          </Link>{" "}
          to see your trajectory.
        </p>
      </main>
    );
  }

  const { asOf: asOfParam, bucket: bucketParam } = await searchParams;
  const asOf = parseInstant(asOfParam);
  const bucket = bucketParam === "day" ? "day" : "session";

  const ops = await loadOps(user.id);
  const trajectory = buildTrajectory(ops, { bucket, asOf });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <ViewEvent
        event="trajectory_viewed"
        properties={{
          topic_count: trajectory.tracks.length,
          bucket_count: trajectory.buckets.length,
          has_as_of: asOf !== undefined,
        }}
      />

      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Trajectory</h1>
          <p className="mt-1 text-sm text-white/40">
            {trajectory.tracks.length} topic{trajectory.tracks.length === 1 ? "" : "s"} across{" "}
            {trajectory.buckets.length} recording
            {trajectory.buckets.length === 1 ? "" : "s"} · {trajectory.revisions.length} revision
            {trajectory.revisions.length === 1 ? "" : "s"}
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

      {trajectory.buckets.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/30 p-4">
            <Stream trajectory={trajectory} asOf={asOf} />
          </section>

          <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1fr]">
            <Legend trajectory={trajectory} />
            <Revisions trajectory={trajectory} />
          </div>
        </>
      )}
    </div>
  );
}

function parseInstant(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The bands, named.
 *
 * Ordered exactly as the chart stacks them — first appearance — so reading down
 * the list is reading up the stack. `current` is what is live now and `weight`
 * is how much was ever put into it, and the two differing is the interesting
 * case: a topic worked over heavily and then almost entirely superseded.
 */
function Legend({ trajectory }: { trajectory: ReturnType<typeof buildTrajectory> }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-white/50">Topics, as they appeared</h2>
      <ol className="space-y-1.5">
        {trajectory.tracks.map((track) => {
          const Icon = topicIcon(track.icon);
          return (
            <li key={track.topicId} className="flex items-baseline gap-2.5 text-sm">
              <Icon size={14} aria-hidden className="shrink-0 translate-y-0.5 text-white/30" />
              <span className={track.current === 0 ? "text-white/35 line-through" : ""}>
                {track.title}
              </span>
              <span className="ml-auto shrink-0 font-mono text-xs text-white/25">
                {track.current} · {track.weight}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-white/25">
        Live blocks · total changes. A struck-through topic has nothing left standing.
      </p>
    </section>
  );
}

/**
 * Where the thinking changed its mind.
 *
 * The single most interesting thing the op log holds, and invisible in the
 * workspace by construction — the balance sheet shows the balance, not the
 * entries. `from → to` is a claim being replaced by a sharper or contrary one.
 */
function Revisions({ trajectory }: { trajectory: ReturnType<typeof buildTrajectory> }) {
  const recent = [...trajectory.revisions].reverse().slice(0, 12);

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-white/50">Where it changed</h2>
      {recent.length === 0 ? (
        <p className="text-sm text-white/30">
          Nothing has been superseded yet. Revisions appear here as the same idea comes
          round again, sharper.
        </p>
      ) : (
        <ol className="space-y-3">
          {recent.map((revision) => (
            <li
              key={revision.to.id}
              className="border-l border-[var(--color-line)] pl-3 text-sm leading-snug"
            >
              <p className="text-white/30 line-through">{revision.from.text}</p>
              <p className="mt-0.5 flex gap-1.5 text-white/80">
                <ArrowRight size={13} aria-hidden className="mt-1 shrink-0 text-white/25" />
                <span>{revision.to.text}</span>
              </p>
              <p className="mt-1 text-[11px] text-white/25">
                {revision.at.toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-line)] p-10 text-center">
      <p className="mb-1 font-medium">No trajectory yet</p>
      <p className="text-sm text-white/40">
        This is built from the workspace, which is built from what you say.{" "}
        <Link href="/record" className="underline">
          Start recording
        </Link>
        .
      </p>
    </div>
  );
}
