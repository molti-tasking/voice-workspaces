"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import type { DraftCue } from "@/lib/display/use-cues";

/**
 * Text the agent was asked to write, with a button that copies it.
 *
 * ## Why this is allowed to be tappable when the cue panel is not
 *
 * `cue-panel.tsx` states the rule: nothing there is tappable, because every
 * setting it renders in is one where the hands are busy and confirmation
 * happens by voice. A draft is the exception that proves it — the person
 * explicitly asked for something to *take away*, and taking it away is a
 * deliberate two-handed act performed when they have stopped. There is no
 * voice equivalent of "put this on my clipboard".
 *
 * It only ever appears where `displayAllowed` is true, so the driving case
 * never sees a button at all: a draft asked for at 110 km/h is written, stored,
 * and waiting on `/sessions/[id]` afterwards.
 *
 * ## Why it does not reorder or truncate
 *
 * The panel above holds slots still because a re-sorted list has to be re-read
 * from the top. That reasoning does not transfer: this list is short, appended
 * to, and read deliberately rather than glanced at. Nothing here is cut — a
 * draft clipped to eight words is not a draft.
 */
export function DraftPanel({ drafts }: { drafts: DraftCue[] }) {
  if (drafts.length === 0) return null;

  return (
    <section className="w-full max-w-md space-y-2" aria-label="Drafts">
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} />
      ))}
    </section>
  );
}

function DraftCard({ draft }: { draft: DraftCue }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.text);
      setCopied(true);
      // Long enough to be seen without looking for it, short enough that the
      // button is ready again if the paste did not land where they meant.
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* Clipboard refused — an insecure origin, or permission denied. The text
       * is on screen and selectable, which is the fallback, so failing loudly
       * here would cost more than it explains. */
    }
  };

  return (
    <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/40 p-3">
      <header className="mb-1.5 flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[11px] tracking-wide text-white/40 uppercase">
          {draft.title || "Draft"}
        </h3>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex shrink-0 items-center gap-1 rounded border border-[var(--color-line)] px-2 py-1 text-[11px] text-white/50 hover:border-white/30 hover:text-white/90"
        >
          {copied ? (
            <>
              <Check size={12} aria-hidden />
              Copied
            </>
          ) : (
            <>
              <Copy size={12} aria-hidden />
              Copy
            </>
          )}
        </button>
      </header>

      {/*
        `whitespace-pre-wrap` because a draft is written to be pasted: the model
        was told markdown is allowed here, and collapsing its line breaks would
        make an email or a list arrive as one paragraph. Scrolls rather than
        growing, so a long draft cannot push the record button off screen.
      */}
      <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[13px] leading-snug text-white/85">
        {draft.text}
      </p>
    </article>
  );
}
