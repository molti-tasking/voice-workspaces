"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TaskState } from "@voicemural/workspace";

/*
 * Type-only import above, and nothing from `@voicemural/db`: this is a client
 * component, and the database driver in the browser bundle fails `next build`
 * — which is the only check that catches it.
 */

const STATES: TaskState[] = ["open", "next", "doing", "done", "dropped"];

/**
 * The two manual gestures the board allows: move, and "not a task".
 *
 * No manual add. Cards come from speech and only from speech; what the person
 * can do is correct the record, and each correction is an op the evaluation
 * reads. The `opId` is minted here so a retry after a dead zone reaches the
 * server as the same op, not a second one.
 *
 * Optimistic, with rollback: the column the card is in changes at once, and
 * changes back if the server refused. `router.refresh()` then re-folds the
 * page from the ledger so what is shown is what was written.
 */
export function CardActions({ blockId, state }: { blockId: string; state: TaskState }) {
  const router = useRouter();
  const [current, setCurrent] = useState<TaskState | "retired">(state);
  const [pending, startTransition] = useTransition();

  const post = (body: Record<string, unknown>, next: TaskState | "retired") => {
    startTransition(async () => {
      const previous = current;
      setCurrent(next);
      try {
        const res = await fetch(`/api/board/cards/${blockId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, opId: crypto.randomUUID() }),
        });
        if (!res.ok) {
          setCurrent(previous);
          return;
        }
        router.refresh();
      } catch {
        setCurrent(previous);
      }
    });
  };

  if (current === "retired") {
    return <p className="mt-2 text-[11px] text-white/30">Removed from the board.</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {STATES.filter((s) => s !== current).map((s) => (
        <button
          key={s}
          type="button"
          disabled={pending}
          onClick={() => post({ action: "set_state", state: s }, s)}
          className="rounded border border-[var(--color-line)] px-1.5 py-0.5 font-mono text-[10px] text-white/40 hover:border-white/30 hover:text-white/80 disabled:opacity-40"
        >
          {s}
        </button>
      ))}
      <button
        type="button"
        disabled={pending}
        onClick={() => post({ action: "retire" }, "retired")}
        title="Remove this card — it was not a task"
        className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-white/25 hover:text-white/60 disabled:opacity-40"
      >
        not a task
      </button>
    </div>
  );
}
