"use client";

import {
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { TaskState } from "@voicemural/workspace";
import { BoardCard } from "./board-card";
import type { CardView } from "./card-view";
import { isDragData } from "./drag";

/*
 * Type-only import of TaskState's TYPE above is not enough — `TaskState.options`
 * is a value, and it comes from `@voicemural/workspace`, which is pure. Nothing
 * from `@voicemural/db` may be imported here: the database driver in the browser
 * bundle fails `next build`, which is the only check that catches it.
 */

const STATES = TaskState.options;

type Move =
  | { kind: "set_state"; cardId: string; to: TaskState }
  | { kind: "retire"; cardId: string };

/**
 * The board, and the two ways a person may correct it.
 *
 * ## Why the whole board is one client component now
 *
 * A drop target has to know what is being dragged over it, and the card being
 * dragged has to disappear from one column and appear in another before the
 * server has heard about it. Both are one piece of state, so it lives here and
 * the columns and cards are drawn from it.
 *
 * The fold stays on the server regardless. `page.tsx` still does `loadOps` and
 * `foldBoard`; what crosses is `CardView[]`, which is what the browser needs to
 * draw a card and nothing else.
 *
 * ## Columns are the only drop targets
 *
 * Deliberately, and this is the one place the board departs from every kanban
 * app it resembles. A column here is a `state` on a block, and cards inside it
 * are ordered by when they last moved — there is no ordering column in the
 * schema and nowhere to put one. So dropping BETWEEN two cards would animate
 * into place, fire an event carrying an index, and then snap back on the next
 * refresh, because the ledger has no memory of it. A gesture that silently does
 * nothing is worse than one that is not offered.
 *
 * ## Drag is an addition, never the only way
 *
 * The element adapter is built on native HTML5 drag events, which do not fire
 * on touch and are not reachable from a keyboard. The buttons on every card are
 * therefore not a fallback — they are the primary path, and drag is a
 * convenience on top for whoever is at a desk with a mouse. Nothing is reachable
 * only by dragging.
 */
export function BoardSurface({ cards }: { cards: CardView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /*
   * The optimistic column, and why this rather than a hand-rolled override map.
   *
   * `useOptimistic` holds the applied move for exactly as long as the
   * transition runs, and `router.refresh()` is awaited INSIDE that transition —
   * so the optimistic card is replaced by the re-folded server card in one
   * commit, with no window where both or neither is true. On a rejected POST it
   * reverts by itself, which is the correct behaviour and the one most easily
   * got wrong by hand.
   */
  const [shown, applyMove] = useOptimistic(
    cards,
    (current: CardView[], move: Move) => {
      if (move.kind === "retire")
        return current.filter((c) => c.cardId !== move.cardId);
      return current.map((c) =>
        c.cardId === move.cardId
          ? // The marker is deliberately NOT rewritten here. It states what the
            // ledger says, and the ledger has not been written yet; the refresh
            // brings the true one back a moment later.
            { ...c, state: move.to }
          : c,
      );
    },
  );

  const send = useCallback(
    (blockId: string, body: Record<string, unknown>, move: Move) => {
      startTransition(async () => {
        applyMove(move);
        setError(null);
        try {
          const res = await fetch(`/api/board/cards/${blockId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Minted here so a POST retried after a dead zone reaches the
            // server as the same op rather than a second transition.
            body: JSON.stringify({ ...body, opId: crypto.randomUUID() }),
          });
          if (!res.ok) {
            // A drag that springs back with no explanation reads as a bug in
            // the page. Say so — the optimistic state has already reverted.
            setError("That move was not saved. The board is unchanged.");
            return;
          }
          router.refresh();
        } catch {
          setError("Offline — that move was not saved.");
        }
      });
    },
    [applyMove, router],
  );

  const moveCard = useCallback(
    (cardId: string, blockId: string, to: TaskState) =>
      send(
        blockId,
        { action: "set_state", state: to },
        { kind: "set_state", cardId, to },
      ),
    [send],
  );

  // One monitor for the whole board rather than an onDrop per column: the drop
  // target only knows it was dropped on, and the card only knows it was
  // dragged. Pairing them is a board-level fact.
  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => isDragData(source.data),
        onDrop({ source, location }) {
          const target = location.current.dropTargets[0];
          if (!target || !isDragData(source.data)) return;
          const to = target.data.column as TaskState;
          // Dropping a card back where it started is not a transition, and
          // recording one would put a phantom "kept" in the measurement. The
          // route rejects it too; this saves the round trip.
          if (!to || to === source.data.from) return;
          moveCard(source.data.cardId, source.data.blockId, to);
        },
      }),
    [moveCard],
  );

  if (shown.length === 0) return null;

  return (
    <>
      {error && (
        <p role="status" className="mb-4 text-sm text-rose-300/80">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-5">
        {STATES.map((state) => (
          <Column
            key={state}
            state={state}
            cards={shown.filter((c) => c.state === state)}
          />
        ))}
      </div>
    </>
  );
}

function Column({ state, cards }: { state: TaskState; cards: CardView[] }) {
  const ref = useRef<HTMLElement | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return dropTargetForElements({
      element,
      getData: () => ({ column: state }),
      // A card already in this column is not a move. Refusing it here is what
      // stops the column lighting up as a valid target for a no-op.
      canDrop: ({ source }) =>
        isDragData(source.data) && source.data.from !== state,
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: () => setOver(false),
    });
  }, [state]);

  return (
    <section
      ref={ref}
      className={[
        "min-w-0 rounded-xl border border-dashed p-1 transition-colors",
        // Only ever a border and a wash: the column must not change size when a
        // card is over it, or every other column shifts under the cursor.
        over ? "border-white/25 bg-white/3" : "border-transparent",
      ].join(" ")}
    >
      <h2 className="mb-2 flex items-baseline gap-2 px-1 text-[11px] tracking-wide text-white/30 uppercase">
        {state}
        <span className="font-mono text-[10px] text-white/20">
          {cards.length}
        </span>
      </h2>
      <div className="space-y-3">
        {cards.map((card) => (
          <BoardCard key={card.cardId} card={card} />
        ))}
      </div>
    </section>
  );
}
