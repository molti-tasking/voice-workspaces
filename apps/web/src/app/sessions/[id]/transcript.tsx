"use client";

import { useRef, useState } from "react";
import { formatOffset } from "@voicemural/shared";

export interface TranscriptRow {
  id: string;
  chunkId: string;
  startOffsetMs: number;
  endOffsetMs: number;
  text: string;
  kind: "content" | "directive" | "unclassified";
  kindOverride: "content" | "directive" | "unclassified" | null;
  chunkStartOffsetMs: number;
}

/**
 * The transcript, with playback anchored to each utterance.
 *
 * Clicking a line seeks into the audio chunk it came from — this is the
 * provenance claim made operable, and the demo the paper leans on.
 */
export function Transcript({ rows }: { rows: TranscriptRow[] }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<{ chunkId: string; utteranceId: string } | null>(
    null,
  );

  function play(row: TranscriptRow) {
    const el = audioRef.current;
    if (!el) return;

    // Offsets are session-absolute; audio is served per chunk, so seek to the
    // utterance's position WITHIN its chunk.
    const withinChunkSec = Math.max(0, (row.startOffsetMs - row.chunkStartOffsetMs) / 1000);

    if (playing?.chunkId !== row.chunkId) {
      el.src = `/api/audio/${row.chunkId}`;
      el.load();
      const onReady = () => {
        el.currentTime = withinChunkSec;
        void el.play();
        el.removeEventListener("loadedmetadata", onReady);
      };
      el.addEventListener("loadedmetadata", onReady);
    } else {
      el.currentTime = withinChunkSec;
      void el.play();
    }

    setPlaying({ chunkId: row.chunkId, utteranceId: row.id });
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-white/40">
        No transcript yet. Chunks are transcribed by the worker — check that it is
        running.
      </p>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} className="sr-only" preload="none" />
      <ol className="space-y-1">
        {rows.map((row) => {
          const effectiveKind = row.kindOverride ?? row.kind;
          const isPlaying = playing?.utteranceId === row.id;
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => play(row)}
                className={[
                  "flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  isPlaying ? "bg-white/10" : "hover:bg-white/5",
                ].join(" ")}
              >
                <span className="shrink-0 pt-0.5 font-mono text-xs text-white/30 tabular-nums">
                  {formatOffset(row.startOffsetMs)}
                </span>
                <span
                  className={
                    effectiveKind === "directive"
                      ? "text-amber-300"
                      : effectiveKind === "unclassified"
                        ? "text-white/70"
                        : "text-white"
                  }
                >
                  {row.text}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
