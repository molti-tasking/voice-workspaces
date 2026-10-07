"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { DraftMarkdown } from "@/components/draft-markdown";
import type { DraftCue, DraftVersionCue } from "@/lib/display/use-cues";

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
 * It only ever appears where the profile's `displayAllowed` is true. A draft
 * asked for at 110 km/h is written, stored, and waiting on `/sessions/[id]`
 * afterwards whether or not anyone looked.
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
 * report. So the label and the time are shown; editing and Restore live on
 * `/sessions/[id]`, because this panel only exists in settings where the
 * person's hands are somewhere else.
 *
 * ## Why the label becomes a picker once there are two
 *
 * On 7 Oct 2026 the person saw a draft's two versions and wanted to look back
 * at the first from here, not from the transcript page. So a card with more
 * than one version turns its label into a native select: reading an earlier
 * version, and copying it, is one tap, and nothing is changed by it. A new
 * version arriving snaps the card back to the newest, because that is the
 * text the agent just said is there.
 */
export function DraftPanel({ drafts }: { drafts: DraftCue[] }) {
  if (drafts.length === 0) return null;

  return (
    // Named on screen, and anchored. The agent tells people their text is
    // "under the drafts", and on 27 Sep 2026 there was nothing on the screen
    // called that — only unlabelled cards at the foot of the page, under the
    // dock's scrim. The header's drafts count links here.
    <section id="drafts" className="w-full max-w-md scroll-mt-28 space-y-2" aria-labelledby="drafts-heading">
      <h2 id="drafts-heading" className="text-sm font-medium text-fg/70">
        Drafts on this drive <span className="text-fg/45 tabular-nums">({drafts.length})</span>
      </h2>
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} />
      ))}
    </section>
  );
}

function DraftCard({ draft }: { draft: DraftCue }) {
  const [copied, setCopied] = useState(false);
  // The version being read, or null for the newest. Reset when the head moves,
  // during render rather than in an effect, so the new text is never one frame
  // behind its label.
  const [picked, setPicked] = useState<string | null>(null);
  const [head, setHead] = useState(draft.version);
  if (head !== draft.version) {
    setHead(draft.version);
    setPicked(null);
  }

  const versions = draft.versions ?? [];
  const shown: Pick<DraftVersionCue, "title" | "text" | "version" | "at"> =
    versions.find((v) => v.id === picked) ?? draft;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.text);
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
    <article className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]/40 p-3">
      <header className="mb-1.5 flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 truncate text-xs tracking-wide text-fg/60 uppercase">
          {shown.title || draft.title || "Draft"}
        </h3>
        {/* `v2.1 · 14:32`. Tabular so the number does not shift the Copy button
            around as versions accumulate. */}
        {versions.length > 1 ? (
          <select
            aria-label="Version"
            value={picked ?? versions[0]!.id}
            onChange={(e) => setPicked(e.target.value === versions[0]!.id ? null : e.target.value)}
            className="shrink-0 cursor-pointer rounded border border-[var(--color-line)] bg-transparent px-1 py-0.5 font-mono text-xs text-fg/60 tabular-nums hover:border-fg/30"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.version} · {formatTime(v.at)}
                {v.author === "user" ? " · yours" : ""}
              </option>
            ))}
          </select>
        ) : (
          <span className="shrink-0 font-mono text-xs text-fg/45 tabular-nums">
            {draft.version} · {formatTime(draft.at)}
          </span>
        )}
        <button
          type="button"
          onClick={() => void copy()}
          className="flex shrink-0 items-center gap-1 rounded border border-[var(--color-line)] px-2 py-1 text-xs text-fg/65 hover:border-fg/30 hover:text-fg/90"
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
        Rendered from its markdown (`DraftMarkdown`), keeping its line breaks,
        so an email or a list arrives as one; Copy still takes the raw text.
        Scrolls rather than growing, so a long draft cannot push the record
        button off screen.
      */}
      {/* `select-text` because `main` turns selection off for the rest of the
          screen, which made the fallback promised in `copy` above untrue. */}
      <DraftMarkdown
        text={shown.text}
        className="max-h-56 select-text overflow-y-auto text-[0.8125rem] leading-snug text-fg/85"
      />
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
