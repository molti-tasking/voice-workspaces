"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * The drafts from one drive, after it.
 *
 * The half of the feature that matters most, and the reason drafts are a table
 * rather than a message on the data channel. A draft asked for while driving
 * has no screen to appear on at the time — `SETTING_PROFILES.driving` sets
 * `displayAllowed: false` and the cue stream does not even open — so this page
 * is the FIRST time the person sees it. It is also where they will be when they
 * actually want to paste it: at a desk, on a different device, hours later.
 *
 * A client component only because copying needs the clipboard; the rows come
 * from the server page.
 */
export interface SessionDraft {
  id: string;
  title: string;
  text: string;
  startOffsetMs: number;
  respondingToText: string | null;
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
          <DraftCard key={draft.id} draft={draft} />
        ))}
      </div>
    </section>
  );
}

function DraftCard({ draft }: { draft: SessionDraft }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The text is on screen and selectable. See draft-panel.tsx.
    }
  };

  return (
    <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/40 p-4">
      <header className="mb-2 flex items-baseline gap-3">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{draft.title || "Draft"}</h3>
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
      </header>

      {/*
        What they said to get it. Kept because a draft read back weeks later is
        far more legible next to the request that produced it — and because a
        draft that misread the request is only diagnosable with both halves.
      */}
      {draft.respondingToText && (
        <p className="mb-2 border-l-2 border-[var(--color-line)] pl-2.5 text-xs text-white/35 italic">
          “{draft.respondingToText}”
        </p>
      )}

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">{draft.text}</p>
    </article>
  );
}
