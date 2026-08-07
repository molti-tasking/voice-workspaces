import { formatOffset } from "@voicemural/shared";

export interface TranscriptRow {
  id: string;
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
  kind: "content" | "directive" | "unclassified";
  kindOverride: "content" | "directive" | "unclassified" | null;
}

/**
 * The verbatim stream.
 *
 * Audio is discarded once transcribed, so there is nothing to play back — this
 * is a reading view. Offsets are kept because provenance runs through them:
 * a derived sentence points at an utterance, and an utterance at its position
 * in the session.
 *
 * A server component: no interactivity left to warrant shipping JavaScript.
 */
export function Transcript({ rows }: { rows: TranscriptRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-white/40">
        No transcript yet. Chunks are transcribed by the worker — check that it is
        running.
      </p>
    );
  }

  return (
    <ol className="space-y-1">
      {rows.map((row) => {
        const kind = row.kindOverride ?? row.kind;
        return (
          <li key={row.id} className="flex gap-3 rounded-lg px-3 py-1.5">
            <span
              className="shrink-0 pt-0.5 font-mono text-xs text-white/25 tabular-nums"
              title={`${formatOffset(row.startOffsetMs)}–${formatOffset(row.endOffsetMs)}`}
            >
              {formatOffset(row.startOffsetMs)}
            </span>
            <span
              className={
                kind === "directive"
                  ? "text-amber-300"
                  : kind === "unclassified"
                    ? "text-white/80"
                    : "text-white"
              }
            >
              {row.text}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
