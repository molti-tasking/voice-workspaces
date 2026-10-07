import { ArrowUpRight, CircleDot } from "lucide-react";
import type {
  TimelineAgentTurn,
  TimelineMarker,
  TimelineSession,
  TimelineUtterance,
} from "@voicemural/db/workspace";
import { formatOffset } from "@voicemural/shared";
import { AgentTurnBubble } from "@/components/agent-turn-bubble";
import { Link } from "@/components/nav-link";
import { MarkerLink } from "./marker-link";

/**
 * One drive on the ledger.
 *
 * Utterances in the order they were spoken, with workspace markers interleaved
 * at the point where each extraction consumed its last utterance — so the
 * balance sheet snapshots sit inside the journal that produced them.
 */
export function SessionBlock({
  session,
  utterances,
  markers,
  agentTurns = [],
}: {
  session: TimelineSession;
  utterances: TimelineUtterance[];
  markers: TimelineMarker[];
  agentTurns?: TimelineAgentTurn[];
}) {
  // Merge into one stream so a marker lands between the utterance it consumed
  // and the next one, rather than floating at the end of the session.
  const items = interleave(utterances, markers, agentTurns);

  return (
    <section
      id={`session-${session.id}`}
      className="scroll-mt-[calc(5rem+var(--vm-live-bar,0px))]"
    >
      {/* Under the live drive bar when there is one; see `LiveDriveBar`. */}
      <header className="sticky top-[var(--vm-live-bar,0px)] z-10 -mx-4 mb-3 flex items-baseline justify-between gap-3 bg-[var(--color-canvas)]/85 px-4 py-2 backdrop-blur">
        <h2 className="min-w-0 text-sm font-medium">
          {/* Its name first, when it has one: a column of dates says when
              each drive was, never which one you are looking for. */}
          {session.title && <span className="mr-2">{session.title} ·</span>}
          {session.startedAt.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          <span className="ml-2 font-normal text-fg/50">
            {session.startedAt.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}
            {formatOffset(session.recordedMs)}
            {" · "}
            {session.utteranceCount} utterance
            {session.utteranceCount === 1 ? "" : "s"}
          </span>
        </h2>
        {/* The drive's own page — its drafts, failed audio and retry — from
            the one list of drives there now is. The separate session list was
            a second copy of this page's headings. */}
        <Link
          href={`/sessions/${session.id}`}
          className="flex shrink-0 items-center gap-0.5 text-xs text-fg/55 hover:text-fg/80"
        >
          Details
          <ArrowUpRight size={12} aria-hidden />
        </Link>
      </header>

      <ol className="space-y-1 border-l border-[var(--color-line)] pl-4">
        {items.map((item) =>
          item.kind === "marker" ? (
            <MarkerRow
              key={`m-${item.marker.extractionId}`}
              marker={item.marker}
            />
          ) : item.kind === "agent" ? (
            <AgentRow key={`a-${item.turn.id}`} turn={item.turn} />
          ) : (
            <UtteranceRow key={item.utterance.id} utterance={item.utterance} />
          ),
        )}
      </ol>
    </section>
  );
}

/**
 * One agent turn, in the timeline's gutter.
 *
 * Right-aligned against the left-aligned utterances so the two sides of a
 * conversation are distinguishable without reading, and drawn with the same
 * bubble `/sessions/[id]` uses — the whole point of extracting it.
 */
function AgentRow({ turn }: { turn: TimelineAgentTurn }) {
  return (
    <li className="flex gap-3 py-0.5">
      <span className="w-12 shrink-0 pt-1 text-right font-mono text-xs text-fg/35 tabular-nums">
        {turn.occurredAt.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      <div className="min-w-0 flex-1 text-right">
        <AgentTurnBubble
          seq={turn.seq}
          text={turn.text}
          generatedText={turn.generatedText}
          bargedIn={turn.bargedIn}
          error={turn.error}
        />
      </div>
    </li>
  );
}

function UtteranceRow({ utterance }: { utterance: TimelineUtterance }) {
  return (
    <li className="flex gap-3 py-0.5 text-sm leading-snug">
      <span className="w-12 shrink-0 pt-px text-right font-mono text-xs text-fg/35 tabular-nums">
        {utterance.occurredAt.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      <span
        className={
          utterance.kind === "directive" ? "text-amber-300/90" : "text-fg/75"
        }
      >
        {utterance.text}
      </span>
    </li>
  );
}

/**
 * A jump into the workspace as it stood at this moment.
 *
 * `since` carries the previous marker's time, so the target page can show the
 * diff this extraction produced rather than only the state it left behind.
 */
function MarkerRow({ marker }: { marker: TimelineMarker }) {
  const changed = marker.opCount > 0;

  const params = new URLSearchParams({ asOf: marker.occurredAt.toISOString() });
  if (marker.since) params.set("since", marker.since.toISOString());

  const summary = [
    marker.newTopics > 0 &&
      `${marker.newTopics} topic${marker.newTopics === 1 ? "" : "s"}`,
    marker.addedBlocks > 0 && `+${marker.addedBlocks}`,
    marker.revisedBlocks > 0 && `${marker.revisedBlocks} revised`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="-ml-[21px] py-1.5">
      <MarkerLink
        href={`/workspace?${params.toString()}`}
        extractionId={marker.extractionId}
        opCount={marker.opCount}
        totalTokens={marker.totalTokens}
        resolvedModel={marker.resolvedModel}
        className={[
          "group inline-flex items-center gap-2 rounded-full border py-1 pr-2.5 pl-1.5 text-xs transition-colors",
          changed
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
            : "border-[var(--color-line)] bg-fg/[0.03] text-fg/45 hover:text-fg/65",
        ].join(" ")}
        title={`${marker.totalTokens} tokens · ${marker.resolvedModel}`}
      >
        <CircleDot size={11} aria-hidden className="shrink-0" />
        <span>{changed ? summary : "no change"}</span>
        {changed && (
          <ArrowUpRight
            size={11}
            aria-hidden
            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </MarkerLink>
    </li>
  );
}

type Item =
  | { kind: "utterance"; at: number; utterance: TimelineUtterance }
  | { kind: "marker"; at: number; marker: TimelineMarker }
  | { kind: "agent"; at: number; turn: TimelineAgentTurn };

/**
 * Utterances, agent turns and markers on one stream.
 *
 * Markers sort after the utterance they consumed; agent turns sort by when they
 * were spoken. Agent turns are resolved to wall-clock in the loader, because
 * this page's axis is absolute time across every drive while `agent_turn`
 * stores offsets into one.
 */
function interleave(
  utterances: TimelineUtterance[],
  markers: TimelineMarker[],
  agentTurns: TimelineAgentTurn[] = [],
): Item[] {
  const items: Item[] = [
    ...utterances.map((u) => ({
      kind: "utterance" as const,
      at: u.occurredAt.getTime(),
      utterance: u,
    })),
    ...agentTurns.map((t) => ({
      kind: "agent" as const,
      at: t.occurredAt.getTime(),
      turn: t,
    })),
    ...markers.map((m) => ({
      kind: "marker" as const,
      // +1ms so a marker sorts *after* the utterance it consumed, which shares
      // its timestamp exactly.
      at: m.occurredAt.getTime() + 1,
      marker: m,
    })),
  ];

  return items.sort((a, b) => a.at - b.at);
}
