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
 *
 * ## Why the version label, and why nothing else
 *
 * "Make it shorter" appends a VERSION to the draft that is already here, so the
 * text changes inside the card the person is looking at. Without the label the
 * only evidence of that would be the words themselves being different, which is
 * exactly the kind of thing a screen in the corner of someone's eye cannot
 * report. So the label and the time are shown, and nothing more: editing,
 * history and Restore live on `/sessions/[id]`, because this panel only exists
 * in settings where the person's hands are somewhere else.
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
        {/* `v2.1 · 14:32`. Tabular so the number does not shift the Copy button
            around as versions accumulate. */}
        <span className="shrink-0 font-mono text-[10px] text-white/25 tabular-nums">
          {draft.version} · {formatTime(draft.at)}
        </span>
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

/**
 * The clock time a version was written.
 *
 * Formatted in the browser, unlike `/sessions/[id]` — this panel is only ever
 * rendered client-side, from a stream that starts after mount, so there is no
 * server render for it to disagree with. A malformed timestamp renders as
 * nothing rather than "Invalid Date" in the corner of a driver's eye.
 */
function formatTime(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
