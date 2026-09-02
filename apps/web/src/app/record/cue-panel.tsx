"use client";

import { ENTER_MS, PANEL_MIN_ROWS, toGlance } from "@/lib/display/rules";
import type { Cue, CueState } from "@/lib/display/use-cues";

/**
 * The secondary display.
 *
 * The claim it embodies: a screen alongside a voice interaction can extend
 * someone's thinking space rather than compete for it, if it is built for a
 * glance instead of a read. Every rule below is in `@/lib/display/rules`, and
 * they are the contribution — this file is what obeys them.
 *
 * What that means in practice:
 *
 * - **Fixed height, always.** The panel reserves `PANEL_MIN_ROWS` whether it is
 *   full or empty, so nothing on `/record` moves when a cue lands. Motion is
 *   what makes someone look up, and looking up is the cost being avoided.
 * - **No reordering.** `settle` in the hook holds each item's slot for as long
 *   as it is shown. A re-sorted list has to be re-read from the top.
 * - **One animation.** A 400ms opacity ramp, on the arriving item only.
 * - **Never announced.** `aria-live="off"`, like the live exchange above it: a
 *   screen reader reading this out would interrupt the thought it exists to
 *   support.
 * - **Nothing is tappable.** Confirmation happens by voice. A touch target here
 *   would invite exactly the interaction the setting rules out.
 *
 * The two lanes are visually distinct on purpose. Content is what was extracted
 * from the thinking; directions are what the system took as being addressed to
 * it. Making that split inspectable at a glance is the Midas-touch problem
 * turned into something the user can check without listening back.
 */
export function CuePanel({ cues }: { cues: CueState }) {
  if (!cues.displayAllowed) return null;

  const rows = cues.content.length + cues.directions.length;
  const empty = rows === 0;

  return (
    <section
      className="w-full max-w-md"
      // Never announced. See the file comment.
      aria-live="off"
      aria-label="Captured so far"
    >
      <div
        className="flex flex-col justify-end gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]/30 px-3 py-2.5"
        // Height reserved from the first render, so a cue arriving never
        // reflows the record button above it.
        style={{ minHeight: `${PANEL_MIN_ROWS * 1.65}rem` }}
      >
        {empty ? (
          <p className="text-center text-[13px] text-white/25">
            {cues.pending > 0 ? "Listening…" : "Nothing captured yet."}
          </p>
        ) : (
          <>
            {cues.directions.map((cue) => (
              <DirectionRow key={cue.id} cue={cue} />
            ))}
            {cues.content.map((cue) => (
              <ContentRow key={cue.id} cue={cue} />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * What the system took as being addressed to it.
 *
 * Mono and dimmer than content, prefixed with a chevron: the point is that a
 * direction is legible as a direction from two feet away, without reading it.
 * An unresolved one — an operation with no capability behind it — is marked,
 * because that is the case the macro detector will later offer back, and seeing
 * it now is what makes the offer make sense.
 */
function DirectionRow({ cue }: { cue: Cue }) {
  return (
    <p
      className="flex items-baseline gap-1.5 font-mono text-[13px] leading-snug text-sky-300/70 motion-reduce:animate-none"
      style={{ animation: `vm-cue-in ${ENTER_MS}ms ease-out` }}
    >
      <span aria-hidden className="shrink-0 opacity-50">
        ›
      </span>
      <span className="min-w-0 truncate">{toGlance(cue.text)}</span>
      {cue.resolved === false && (
        <span aria-hidden className="shrink-0 text-[10px] text-white/20">
          new
        </span>
      )}
    </p>
  );
}

/** What was extracted from the thinking. Brighter, and the reason to glance. */
function ContentRow({ cue }: { cue: Cue }) {
  return (
    <p
      className="truncate text-sm leading-snug text-white/85 motion-reduce:animate-none"
      style={{ animation: `vm-cue-in ${ENTER_MS}ms ease-out` }}
    >
      {toGlance(cue.text)}
    </p>
  );
}
