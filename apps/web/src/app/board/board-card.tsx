"use client";

import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useRef, useState } from "react";
import { topicIcon } from "@/app/workspace/icons";
import type { CardView } from "./card-view";
import type { DragData } from "./drag";

/**
 * One card: the task, where it came from, and how it got to this column.
 *
 * The marker under the text is the thing this page exists to show — see
 * `markerFor` in card-view.ts, where it is computed and tested. The card only
 * renders it.
 *
 * A client component since the board gained drag and drop. It draws from
 * `CardView` rather than the fold's `BoardCard`, so the revision history and
 * the full block never cross into the browser.
 */
export function BoardCard({ card }: { card: CardView }) {
  const ref = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const Icon = topicIcon(card.topicIcon);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return draggable({
      element,
      // Read back by the board's monitor. `from` is here so a drop onto the
      // card's own column can be discarded without a round trip.
      getInitialData: (): DragData => ({
        cardId: card.cardId,
        blockId: card.blockId,
        from: card.state,
      }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [card.cardId, card.blockId, card.state]);

  return (
    <article
      ref={ref}
      /*
       * The whole card drags, as on every board this resembles. The buttons
       * inside still take a click — a native drag only begins once the pointer
       * moves — so the accessible path is not shadowed by the convenient one.
       */
      className={[
        "rounded-xl border border-line bg-ink-soft/40 p-3",
        "cursor-grab active:cursor-grabbing",
        // Left in place at reduced opacity rather than removed: taking it out
        // of the column would reflow every other card under the cursor.
        dragging ? "opacity-40" : "",
      ].join(" ")}
    >
      <header className="mb-1.5 flex items-center gap-1.5 text-[11px] text-white/30">
        {/*
          `topicIcon` selects from a module-level map of Lucide components, so
          the identity is stable for a given name; the rule cannot see through
          the lookup. Same as `workspace/topic-card.tsx`.
        */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{card.topicTitle}</span>
      </header>

      <p className="text-sm leading-snug">{card.text}</p>

      <p className="mt-1.5 text-[11px] text-white/30">
        said {card.said} · {card.spanCount} utterance
        {card.spanCount === 1 ? "" : "s"}
      </p>

      {card.marker && (
        <p className="mt-1 font-mono text-[10px] text-amber-300/70">
          {card.marker}
        </p>
      )}
    </article>
  );
}
