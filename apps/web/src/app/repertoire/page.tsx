import type { Metadata } from "next";
import { LayoutGrid, ListTree, Waypoints } from "lucide-react";
import { Link } from "@/components/nav-link";
import { artifact, getDb, inArray } from "@voicemural/db";
import {
  invocationStats,
  listMacroProposals,
  loadCapabilityOrigins,
  loadCapabilityVersions,
  loadRepertoire,
} from "@voicemural/db/repertoire";
import { AccountMenu } from "@/components/account-menu";
import { currentUser } from "@/lib/session";
import { ViewEvent } from "@/lib/analytics/view-event";
import { CapabilityCard, type CapabilityView } from "./capability-card";
import { GrowthCurve, type GrowthPoint } from "./growth-curve";
import { ProposalCard, type Proposal } from "./proposal-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Repertoire",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  { type: "action", title: "Actions", blurb: "Operations on the record." },
  { type: "mode", title: "Modes", blurb: "How turn-taking works, and what silence means." },
  { type: "persona", title: "Personas", blurb: "The register of the system's own turns." },
  { type: "rule", title: "Rules", blurb: "Actions bound to an event." },
] as const;

/**
 * What the system can do for this person, and how it came to be able to.
 *
 * The repertoire is the paper's dependent variable, so this page is deliberately
 * a measurement instrument as much as a settings screen: capabilities are
 * frequency-ordered within their type — usage counts accrue from the start,
 * which gives that for free — versions are visible because
 * `capability_version` is append-only and edits are the point, and the growth
 * curve at the top is the claim itself, that a personal repertoire grows and
 * stabilises through use.
 *
 * Proposals come first. A macro the system noticed is the only thing on this
 * page that is waiting on the person.
 */
export default async function RepertoirePage() {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-white/60">
          <Link href="/" className="underline">
            Sign in
          </Link>{" "}
          to see your repertoire.
        </p>
      </main>
    );
  }

  const [capabilities, stats, origins, proposalRows] = await Promise.all([
    loadRepertoire(user.id, { includeRetired: true }),
    invocationStats(user.id),
    loadCapabilityOrigins(user.id),
    listMacroProposals(user.id, "proposed"),
  ]);

  const versions = await loadCapabilityVersions(
    user.id,
    capabilities.map((c) => c.id),
  );

  const replayIds = proposalRows
    .map((p) => p.replayArtifactId)
    .filter((id): id is string => id !== null);

  const replays =
    replayIds.length > 0
      ? await getDb().select().from(artifact).where(inArray(artifact.id, replayIds))
      : [];

  const statsById = new Map(stats.map((s) => [s.capabilityId, s]));
  const originById = new Map(origins.map((o) => [o.capabilityId, o.createdVia]));
  const replayById = new Map(replays.map((r) => [r.id, r]));

  const views: CapabilityView[] = capabilities.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    restatement: c.restatement,
    markdown: c.markdown,
    version: c.version,
    retiredAt: c.retiredAt,
    createdVia: originById.get(c.id) ?? null,
    fires: statsById.get(c.id)?.fires ?? 0,
    lastFiredAt: statsById.get(c.id)?.lastFiredAt ?? null,
    history: versions
      .filter((v) => v.capabilityId === c.id)
      .map((v) => ({ version: v.version, restatement: v.restatement, createdAt: v.createdAt })),
  }));

  const proposals: Proposal[] = proposalRows.map((p) => {
    const replay = p.replayArtifactId ? replayById.get(p.replayArtifactId) : undefined;
    return {
      id: p.id,
      canonicalForm: p.canonicalForm,
      proposedName: p.proposedName,
      restatement: p.restatement,
      markdown: p.markdown,
      occurrenceCount: p.occurrences.length,
      sessionCount: p.sessionCount,
      occurrences: p.occurrences.map((o) => ({ text: o.text, occurredAt: o.occurredAt })),
      replay: replay ? { title: replay.title, body: replay.body } : null,
    };
  });

  /* The curve is built from origins, not capabilities: `capability.createdAt`
   * says when the row appeared, and `capability_origin.createdAt` says when it
   * entered the repertoire. For a seeded starter those are the same moment; for
   * anything crystallised they need not be. */
  const growth: GrowthPoint[] = origins.map((o) => ({
    at: o.createdAt,
    createdVia: o.createdVia,
  }));

  const totalFires = stats.reduce((n, s) => n + s.fires, 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <ViewEvent
        event="repertoire_viewed"
        properties={{
          capability_count: capabilities.length,
          proposal_count: proposals.length,
          total_invocations: totalFires,
        }}
      />

      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Repertoire</h1>
          <p className="mt-1 text-sm text-white/40">
            {capabilities.length} capabilit{capabilities.length === 1 ? "y" : "ies"} ·{" "}
            {totalFires} use{totalFires === 1 ? "" : "s"}
            {proposals.length > 0 && ` · ${proposals.length} waiting on you`}
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
            href="/timeline"
            className="flex items-center gap-1.5 text-white/40 underline-offset-4 hover:underline"
          >
            <ListTree size={14} aria-hidden />
            Timeline
          </Link>
          <AccountMenu />
        </nav>
      </header>

      {proposals.length > 0 && (
        <section className="mb-10 grid gap-4 md:grid-cols-2">
          {proposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </section>
      )}

      {growth.length > 1 && (
        <section className="mb-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/30 p-4">
          <h2 className="mb-2 text-sm font-medium text-white/50">How it grew</h2>
          <GrowthCurve points={growth} />
        </section>
      )}

      {capabilities.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-10">
          {SECTIONS.map((section) => {
            const inSection = views
              .filter((v) => v.type === section.type)
              // Frequency-ordered, then alphabetical. Usage counts accrue from
              // the first fire, so this ordering costs nothing to maintain and
              // puts what the person actually uses at the top.
              .sort((a, b) => b.fires - a.fires || a.name.localeCompare(b.name));

            if (inSection.length === 0) return null;

            return (
              <section key={section.type}>
                <h2 className="text-sm font-medium text-white/50">{section.title}</h2>
                <p className="mb-3 text-xs text-white/25">{section.blurb}</p>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {inSection.map((capability) => (
                    <CapabilityCard key={capability.id} capability={capability} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-line)] p-10 text-center">
      <p className="mb-1 font-medium">Nothing here yet</p>
      <p className="text-sm text-white/40">
        The starter repertoire installs on first sign-in, and grows from what you
        actually ask for.{" "}
        <Link href="/record" className="underline">
          Start recording
        </Link>
        .
      </p>
    </div>
  );
}
