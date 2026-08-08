import Link from "next/link";
import { ArrowUpRight, CircleDot } from "lucide-react";
import { formatOffset } from "@voicemural/shared";
import type {
  TimelineMarker,
  TimelineSession,
  TimelineUtterance,
} from "@voicemural/db/workspace";

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
}: {
  session: TimelineSession;
  utterances: TimelineUtterance[];
  markers: TimelineMarker[];
}) {
  // Merge into one stream so a marker lands between the utterance it consumed
  // and the next one, rather than floating at the end of the session.
  const items = interleave(utterances, markers);

  return (
    <section id={`session-${session.id}`} className="scroll-mt-20">
      <header className="sticky top-0 z-10 -mx-4 mb-3 bg-[var(--color-ink)]/85 px-4 py-2 backdrop-blur">
        <h2 className="text-sm font-medium">
          {session.startedAt.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          <span className="ml-2 font-normal text-white/30">
            {session.startedAt.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}
            {formatOffset(session.recordedMs)}
            {" · "}
            {session.utteranceCount} utterance{session.utteranceCount === 1 ? "" : "s"}
          </span>
        </h2>
      </header>

      <ol className="space-y-1 border-l border-[var(--color-line)] pl-4">
        {items.map((item) =>
          item.kind === "marker" ? (
            <MarkerRow key={`m-${item.marker.extractionId}`} marker={item.marker} />
          ) : (
            <UtteranceRow key={item.utterance.id} utterance={item.utterance} />
          ),
        )}
      </ol>
    </section>
  );
}

function UtteranceRow({ utterance }: { utterance: TimelineUtterance }) {
  return (
    <li className="flex gap-3 py-0.5 text-sm leading-snug">
      <span className="w-12 shrink-0 pt-px text-right font-mono text-[10px] text-white/20 tabular-nums">
        {utterance.occurredAt.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      <span
        className={
          utterance.kind === "directive" ? "text-amber-300/90" : "text-white/75"
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
      <Link
        href={`/workspace?${params.toString()}`}
        className={[
          "group inline-flex items-center gap-2 rounded-full border py-1 pr-2.5 pl-1.5 text-[11px] transition-colors",
          changed
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
            : "border-[var(--color-line)] bg-white/[0.03] text-white/25 hover:text-white/50",
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
      </Link>
    </li>
  );
}

type Item =
  | { kind: "utterance"; at: number; utterance: TimelineUtterance }
  | { kind: "marker"; at: number; marker: TimelineMarker };

/** Utterances and markers on one stream, markers after the utterance they consumed. */
function interleave(
  utterances: TimelineUtterance[],
  markers: TimelineMarker[],
): Item[] {
  const items: Item[] = [
    ...utterances.map((u) => ({
      kind: "utterance" as const,
      at: u.occurredAt.getTime(),
      utterance: u,
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
