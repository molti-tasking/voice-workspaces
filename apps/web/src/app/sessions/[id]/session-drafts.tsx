"use client";

import { Check, Copy, Pencil, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_DRAFT_CHARS, MAX_DRAFT_TITLE_CHARS } from "@/lib/drafts";

/**
 * The drafts from one drive, after it — and the only place they can be changed.
 *
 * The half of the feature that matters most, and the reason drafts are a table
 * rather than a message on the data channel. A draft asked for mid-drive is
 * not read at the time — the screen is in a cradle or a pocket — so this page
 * is often the FIRST time the person actually looks at it. It is also where
 * they will be when they want to use it: at a desk, on a different device,
 * hours later. So this is where editing belongs. `/record` shows the version label and nothing
 * else; there is no editing a paragraph at 110 km/h.
 *
 * The types deliberately mirror `DraftHistory` from `@voicemural/db/drafts`
 * rather than importing it: that module pulls in the Postgres driver, and a
 * client component importing it breaks `pnpm build` (not `pnpm typecheck` —
 * see `@/lib/drafts`). The caps come from `@/lib/drafts`, which exists for
 * exactly this reason.
 */
interface SessionDraftVersion {
  id: string;
  version: string;
  author: "agent" | "user";
  title: string;
  text: string;
  /** `v1.1` when this version was a restore. */
  restoredFrom: string | null;
  /** What was asked for, when the agent wrote it. */
  respondingToText: string | null;
  /** Formatted on the SERVER — see the note in page.tsx about hydration. */
  at: string;
}

export interface SessionDraft {
  /** The LINEAGE id. Stable across versions, which is what keeps an editor open. */
  id: string;
  startOffsetMs: number;
  current: SessionDraftVersion;
  /** Newest first. */
  earlier: SessionDraftVersion[];
}

export function SessionDrafts({ drafts }: { drafts: SessionDraft[] }) {
  if (drafts.length === 0) return null;

  return (
    <section className="mb-8" aria-label="Drafts">
      <h2 className="mb-3 text-[11px] tracking-wide text-white/30 uppercase">
        {drafts.length} draft{drafts.length === 1 ? "" : "s"}
      </h2>
      <div className="space-y-3">
        {drafts.map((draft) => (
          /* Keyed on the LINEAGE, never on the version. A refresh after a save
             — or after the agent rewrote the draft in another tab — would
             otherwise remount the card, throwing away an open editor and
             whatever was typed into it. */
          <DraftCard key={draft.id} draft={draft} />
        ))}
      </div>
    </section>
  );
}

function DraftCard({ draft }: { draft: SessionDraft }) {
  const [editing, setEditing] = useState(false);

  return (
    <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/40 p-4">
      {editing ? (
        <DraftEditor draft={draft} onClose={() => setEditing(false)} />
      ) : (
        <DraftView draft={draft} onEdit={() => setEditing(true)} />
      )}
    </article>
  );
}

function DraftView({ draft, onEdit }: { draft: SessionDraft; onEdit: () => void }) {
  const [copied, setCopied] = useState(false);
  const { current } = draft;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The text is on screen and selectable. See draft-panel.tsx.
    }
  };

  return (
    <>
      <header className="mb-2 flex items-baseline gap-3">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {current.title || "Draft"}
        </h3>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex shrink-0 items-center gap-1.5 rounded border border-[var(--color-line)] px-2.5 py-1 text-xs text-white/50 hover:border-white/30 hover:text-white/90"
        >
          {copied ? (
            <>
              <Check size={13} aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy size={13} aria-hidden />
              Copy
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex shrink-0 items-center gap-1.5 rounded border border-[var(--color-line)] px-2.5 py-1 text-xs text-white/50 hover:border-white/30 hover:text-white/90"
        >
          <Pencil size={13} aria-hidden />
          Edit
        </button>
      </header>

      {/* The label is not decoration: read off a card weeks later it says how
          many times the model rewrote this (the major) and how much hand
          editing each attempt needed (the minor). */}
      <VersionLine version={current} />

      {/*
        What they said to get it. Kept because a draft read back weeks later is
        far more legible next to the request that produced it — and because a
        draft that misread the request is only diagnosable with both halves.
      */}
      {current.respondingToText && (
        <p className="mb-2 border-l-2 border-[var(--color-line)] pl-2.5 text-xs text-white/35 italic">
          “{current.respondingToText}”
        </p>
      )}

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">{current.text}</p>

      <DraftHistory draft={draft} />
    </>
  );
}

/** `v2.1 · edited by you · 14:32`, plus where a restore came from. */
function VersionLine({ version }: { version: SessionDraftVersion }) {
  return (
    <p className="mb-2 flex flex-wrap items-center gap-x-2 text-[11px] text-white/30">
      <span className="font-mono">{version.version}</span>
      <span aria-hidden>·</span>
      <span>{version.author === "user" ? "edited by you" : "written by the agent"}</span>
      {version.restoredFrom && (
        <>
          <span aria-hidden>·</span>
          <span>restored from {version.restoredFrom}</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span>{version.at}</span>
    </p>
  );
}

function DraftEditor({ draft, onClose }: { draft: SessionDraft; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(draft.current.title);
  const [text, setText] = useState(draft.current.text);
  /* The version this edit is aimed at. Held in state rather than read from the
     prop on every render, because a 409 moves it on WITHOUT the person losing
     what they typed: they are shown where the draft went and their next Save
     lands on top of it. */
  const [base, setBase] = useState(draft.current.id);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", baseVersionId: base, title, text }),
      });

      if (res.status === 409) {
        const body = (await res.json()) as { head: SessionDraftVersion };
        setBase(body.head.id);
        setNotice(
          `Changed to ${body.head.version} while you were editing. Your text is still here — save again to put it on top.`,
        );
        // Refresh so the history below shows the version that overtook this
        // one; the editor stays open, holding what they typed.
        router.refresh();
        return;
      }
      if (!res.ok) {
        setNotice("Could not save. The draft itself is untouched.");
        return;
      }

      onClose();
      router.refresh();
    } catch {
      setNotice("Could not save — you may be offline. The draft itself is untouched.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={MAX_DRAFT_TITLE_CHARS}
        aria-label="Draft title"
        placeholder="Draft"
        className="w-full rounded border border-[var(--color-line)] bg-transparent px-2.5 py-1.5 text-sm font-medium outline-none focus:border-white/30"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        /* The same cap the route enforces. `maxLength` is the courtesy — the
           route REFUSES over-length text rather than truncating it, so the two
           agreeing is what stops a paste from being silently refused. */
        maxLength={MAX_DRAFT_CHARS}
        rows={10}
        aria-label="Draft text"
        className="w-full resize-y rounded border border-[var(--color-line)] bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none focus:border-white/30"
      />

      {notice && <p className="text-xs text-amber-200/80">{notice}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !text.trim()}
          className="rounded border border-[var(--color-line)] px-2.5 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white/90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2.5 py-1 text-xs text-white/40 hover:text-white/70"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The earlier versions, folded away.
 *
 * Collapsed by default and styled like `repertoire/capability-card.tsx`: the
 * history is evidence, consulted when something went wrong, and a card that
 * showed five versions at once would bury the one that is current.
 */
function DraftHistory({ draft }: { draft: SessionDraft }) {
  if (draft.earlier.length === 0) return null;

  return (
    <details className="mt-2">
      <summary className="cursor-pointer list-none text-[10px] text-white/20 hover:text-white/50">
        {draft.earlier.length} earlier version{draft.earlier.length === 1 ? "" : "s"}
      </summary>
      <ol className="mt-1 space-y-3 border-l border-[var(--color-line)] pl-2.5">
        {draft.earlier.map((version) => (
          <li key={version.id}>
            <div className="flex items-baseline gap-2">
              <div className="min-w-0 flex-1">
                <VersionLine version={version} />
                {version.respondingToText && (
                  <p className="mb-1 text-[11px] text-white/25 italic">
                    “{version.respondingToText}”
                  </p>
                )}
              </div>
              <RestoreButton draftId={draft.id} base={draft.current.id} versionId={version.id} />
            </div>
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/40">
              {version.text}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * Put an earlier version back — by APPENDING it, not by rewinding.
 *
 * Restoring v1.1 while at v1.3 gives v1.4 "restored from v1.1", so nothing is
 * ever lost and the newest version is always the current one. That is why this
 * is a plain POST with no confirmation: the thing it would be protecting
 * against cannot happen.
 */
function RestoreButton({
  draftId,
  base,
  versionId,
}: {
  draftId: string;
  base: string;
  versionId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const restore = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/drafts/${draftId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", baseVersionId: base, versionId }),
      });
      // A 409 here means the draft moved on since the page was rendered, and
      // the refresh below is the whole recovery: there is nothing typed to
      // preserve, so the person just sees the newer version and can restore
      // again from it.
      if (!res.ok && res.status !== 409) setFailed(true);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void restore()}
      disabled={busy}
      className="flex shrink-0 items-center gap-1 rounded border border-[var(--color-line)] px-2 py-0.5 text-[10px] text-white/40 hover:border-white/30 hover:text-white/80 disabled:opacity-40"
    >
      <RotateCcw size={11} aria-hidden />
      {failed ? "Try again" : "Restore"}
    </button>
  );
}
