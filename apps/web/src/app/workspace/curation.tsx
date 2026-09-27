"use client";

import { Archive, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import type { TaskState } from "@voicemural/workspace";

/**
 * The person curating their own workspace: archive, restore, undo.
 *
 * The pilots' main complaint was a workspace that only ever grew. Every
 * gesture here posts one op to `/api/workspace/ops` — a tombstone, never a
 * delete — and then refreshes the server-rendered page, so what is shown is
 * always the fold of the ledger rather than a client-side guess at it.
 *
 * Archiving is one tap with no confirmation, because it is not destructive:
 * the toast offers Undo for a few seconds, and anything archived stays
 * restorable from the Archived section at the bottom of the page.
 */

type Action =
  | { action: "retire_topic"; topicId: string }
  | { action: "restore_topic"; topicId: string }
  | { action: "retire_block"; blockId: string }
  | { action: "restore_block"; blockId: string }
  | { action: "archive_draft"; draftId: string }
  | { action: "restore_draft"; draftId: string }
  | { action: "set_state"; blockId: string; state: TaskState };

interface Toast {
  message: string;
  undo?: Action;
}

const UNDO_MS = 6000;

const CurationContext = createContext<{
  run: (action: Action, toast?: { message: string; undoable?: boolean }) => Promise<void>;
  pending: boolean;
} | null>(null);

async function post(action: Action): Promise<{ target?: string } | null> {
  const res = await fetch("/api/workspace/ops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...action, opId: crypto.randomUUID() }),
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => ({}))) as { target?: string };
}

function undoOf(action: Action, target: string | undefined): Action | undefined {
  switch (action.action) {
    case "retire_topic":
      return { action: "restore_topic", topicId: target ?? action.topicId };
    case "retire_block":
      return { action: "restore_block", blockId: target ?? action.blockId };
    case "archive_draft":
      return { action: "restore_draft", draftId: action.draftId };
    default:
      return undefined;
  }
}

export function CurationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const show = useCallback((next: Toast | null) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    if (next) timer.current = setTimeout(() => setToast(null), UNDO_MS);
  }, []);

  const run = useCallback(
    async (action: Action, message?: { message: string; undoable?: boolean }) => {
      const result = await post(action);
      if (!result) {
        show({ message: "That did not go through. Try again." });
        return;
      }
      startTransition(() => router.refresh());
      if (message) {
        show({
          message: message.message,
          undo: message.undoable ? undoOf(action, result.target) : undefined,
        });
      }
    },
    [router, show],
  );

  return (
    <CurationContext.Provider value={{ run, pending }}>
      {children}
      {toast && (
        // Above the dock, which sits at the bottom of every page.
        <div
          role="status"
          className="vm-glass fixed inset-x-0 bottom-32 z-50 mx-auto flex w-[min(22rem,calc(100vw-2rem))] items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm"
        >
          <span className="text-fg/80">{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                const undo = toast.undo!;
                show(null);
                void run(undo);
              }}
              className="shrink-0 cursor-pointer rounded-full px-3 py-1.5 font-medium text-fg ring-1 ring-fg/25 hover:bg-fg/10"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </CurationContext.Provider>
  );
}

function useCuration() {
  const ctx = useContext(CurationContext);
  if (!ctx) throw new Error("useCuration outside CurationProvider");
  return ctx;
}

/** Archive a whole topic: it leaves the page, the board and the agent's view. */
export function ArchiveTopicButton({ topicId, title }: { topicId: string; title: string }) {
  const { run, pending } = useCuration();
  return (
    <button
      type="button"
      title="Archive this topic"
      aria-label={`Archive ${title}`}
      disabled={pending}
      onClick={() => run({ action: "retire_topic", topicId }, { message: `Archived “${title}”`, undoable: true })}
      className="shrink-0 cursor-pointer rounded p-1 text-fg/50 transition-colors hover:text-fg/80 disabled:opacity-40"
    >
      <Archive size={14} aria-hidden />
    </button>
  );
}

/**
 * Archive one item. Faint on a phone, where there is no hover to reveal it;
 * hidden until hover or focus on a desktop, so a card is not a column of
 * buttons.
 */
export function ArchiveItemButton({ blockId }: { blockId: string }) {
  const { run, pending } = useCuration();
  return (
    <button
      type="button"
      title="Archive this item"
      aria-label="Archive this item"
      disabled={pending}
      onClick={() => run({ action: "retire_block", blockId }, { message: "Item archived", undoable: true })}
      className="-my-1 shrink-0 cursor-pointer self-start rounded p-1 text-fg/35 transition-opacity hover:text-fg/80 focus:opacity-100 disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100"
    >
      <Archive size={12} aria-hidden />
    </button>
  );
}

/** Archive a draft the agent wrote, from wherever the workspace shows it. */
export function ArchiveDraftButton({ draftId }: { draftId: string }) {
  const { run, pending } = useCuration();
  return (
    <button
      type="button"
      title="Archive this draft"
      aria-label="Archive this draft"
      disabled={pending}
      onClick={() => run({ action: "archive_draft", draftId }, { message: "Draft archived", undoable: true })}
      className="shrink-0 cursor-pointer rounded p-1 text-fg/40 hover:text-fg/80 disabled:opacity-40"
    >
      <Archive size={12} aria-hidden />
    </button>
  );
}

export function RestoreButton(
  props: { topicId: string } | { blockId: string } | { draftId: string },
) {
  const { run, pending } = useCuration();
  const action: Action =
    "topicId" in props
      ? { action: "restore_topic", topicId: props.topicId }
      : "blockId" in props
        ? { action: "restore_block", blockId: props.blockId }
        : { action: "restore_draft", draftId: props.draftId };
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(action, { message: "Restored" })}
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 text-xs text-fg/70 ring-1 ring-fg/20 hover:bg-fg/10 disabled:opacity-40"
    >
      <RotateCcw size={12} aria-hidden />
      Restore
    </button>
  );
}

const STATES: readonly TaskState[] = ["open", "next", "doing", "done", "dropped"];

/**
 * A task's column, changeable where it is shown.
 *
 * A native select rather than five chips: it is one tap on a phone, opens the
 * platform's own picker, and takes no more room than the label it replaces.
 * This is how a phone moves a task now that the board is desktop-only.
 */
export function TaskStateSelect({ blockId, state }: { blockId: string; state: TaskState }) {
  const { run, pending } = useCuration();
  return (
    <select
      aria-label="Task state"
      value={state}
      disabled={pending}
      onChange={(e) => run({ action: "set_state", blockId, state: e.target.value as TaskState })}
      className={[
        "ml-auto shrink-0 cursor-pointer appearance-none rounded bg-transparent px-1 text-right font-mono text-xs",
        "hover:bg-fg/10 focus:bg-fg/10 focus:outline-none disabled:opacity-50",
        state === "done"
          ? "text-emerald-300"
          : state === "open" || state === "dropped"
            ? "text-fg/60"
            : "text-amber-300",
      ].join(" ")}
    >
      {STATES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
