"use client";

import { CircleHelp } from "lucide-react";
import {
  DISPLAY_RULES,
  ENTER_MS,
  groupByTopic,
  toGlance,
  type Density,
} from "@/lib/display/rules";
import type { Cue, CueState } from "@/lib/display/use-cues";

/**
 * The secondary display.
 *
 * The claim it embodies: a screen alongside a voice interaction can extend
 * someone's thinking space rather than compete for it — but only if it is built
 * for how the screen is actually being used. That varies, so this renders at
 * two densities, chosen by the setting.
 *
 * **glance** (`hands_busy`) — hands in the sink, phone a metre away, the screen
 * caught for a second. Few items, cut to eight words, held still for eight
 * seconds, never reordered. What is being economised is a look.
 *
 * **read** (`desk`) — the screen is in front of them. Content is grouped under
 * its topic and typed the way `workspace/topic-card.tsx` types it, because the
 * thing worth watching here is the workspace forming, and it should read the
 * same live as it does afterwards. Nothing is truncated.
 *
 * Shared by both, and not negotiable at either density:
 *
 * - **Reserved height.** Nothing on `/record` moves when a cue lands. Motion is
 *   what makes someone look up.
 * - **No reordering.** `settle` in the hook holds each item's slot for as long
 *   as it is shown; a re-sorted list has to be re-read from the top.
 * - **One animation.** A 400ms opacity ramp, on the arriving item only.
 * - **Never announced.** `aria-live="off"`, like the live exchange above it: a
 *   screen reader reading this out would interrupt the thought it supports.
 * - **Nothing is tappable.** Confirmation happens by voice, and every setting
 *   with a panel is one where the hands are busy.
 *
 * The content/direction split is visible at both densities. Making the
 * Midas-touch classification checkable at a glance — did it take that as an
 * instruction? — is the thing that cannot be done by listening back.
 */
export function CuePanel({ cues }: { cues: CueState }) {
  if (!cues.displayAllowed) return null;

  const rules = DISPLAY_RULES[cues.density];
  const empty = cues.content.length + cues.directions.length === 0;

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
        style={{ minHeight: `${rules.minRows * 1.65}rem` }}
      >
        {empty ? (
          <p className="text-center text-[13px] text-white/25">
            {cues.pending > 0 ? "Listening…" : "Nothing captured yet."}
          </p>
        ) : cues.density === "read" ? (
          <ReadView cues={cues} />
        ) : (
          <GlanceView cues={cues} />
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * Glance
 * ------------------------------------------------------------------------- */

/** Directions first, then content: both flat, both cut, newest at the top. */
function GlanceView({ cues }: { cues: CueState }) {
  return (
    <>
      {cues.directions.map((cue) => (
        <DirectionRow key={cue.id} cue={cue} density="glance" />
      ))}
      {cues.content.map((cue) => (
        <p
          key={cue.id}
          className="truncate text-sm leading-snug text-white/85 motion-reduce:animate-none"
          style={{ animation: `vm-cue-in ${ENTER_MS}ms ease-out` }}
        >
          {toGlance(cue.text, DISPLAY_RULES.glance.maxWords)}
        </p>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Read
 * ------------------------------------------------------------------------- */

/**
 * The workspace forming, live.
 *
 * Grouped by topic and typed by block kind, deliberately mirroring
 * `workspace/topic-card.tsx`: questions loud and amber because they are what is
 * still owed, facts as a label/value pair, claims as the substance. Someone who
 * watches this while talking and then opens `/workspace` afterwards should not
 * have to learn a second visual language for the same data.
 *
 * Topics keep the order their newest block arrived in, which `settle` already
 * fixed — so a topic gaining a block does not jump the list.
 */
function ReadView({ cues }: { cues: CueState }) {
  const groups = groupByTopic(cues.content);

  return (
    <>
      {cues.directions.length > 0 && (
        <div className="space-y-0.5">
          {cues.directions.map((cue) => (
            <DirectionRow key={cue.id} cue={cue} density="read" />
          ))}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.topic} className="space-y-1">
          <h3 className="text-[11px] tracking-wide text-white/30 uppercase">{group.topic}</h3>
          {group.cues.map((cue) => (
            <ContentRow key={cue.id} cue={cue} />
          ))}
        </section>
      ))}
    </>
  );
}

/** One block, typed as the workspace types it. */
function ContentRow({ cue }: { cue: Cue }) {
  const style = { animation: `vm-cue-in ${ENTER_MS}ms ease-out` };

  // What is still owed. Loudest, as on the topic card.
  if (cue.kind === "question") {
    return (
      <p
        className="flex gap-1.5 text-sm leading-snug text-amber-300 motion-reduce:animate-none"
        style={style}
      >
        <CircleHelp size={13} aria-hidden className="mt-1 shrink-0 opacity-60" />
        <span>{cue.text}</span>
      </p>
    );
  }

  // An attribute, not prose. A sentence is a poor container for one.
  if (cue.kind === "fact" && cue.label) {
    return (
      <p
        className="flex gap-2 text-[13px] leading-snug motion-reduce:animate-none"
        style={style}
      >
        <span className="shrink-0 text-white/30">{cue.label}</span>
        <span className="text-white/70">{cue.text}</span>
      </p>
    );
  }

  // The speaker's own asides, kept quieter than the substance.
  const aside = cue.kind === "context" || cue.kind === "meta";

  return (
    <p
      className={[
        "text-sm leading-snug motion-reduce:animate-none",
        aside ? "text-[13px] text-white/40" : "text-white/85",
      ].join(" ")}
      style={style}
    >
      {cue.text}
    </p>
  );
}

/* ---------------------------------------------------------------------------
 * Directions, at both densities
 * ------------------------------------------------------------------------- */

/**
 * What the system took as being addressed to it.
 *
 * Mono and dimmer than content, prefixed with a chevron, so a direction is
 * legible AS a direction without being read. The text is the classifier's
 * restatement — "Marking the bit about the funding." — not the words that were
 * said: the point is to show what it understood, because that is the only way
 * to catch a misread without listening back.
 *
 * An unresolved one — an operation with no capability behind it — is marked,
 * because that is the case the macro detector will later offer back, and having
 * seen it happen is what makes the offer make sense.
 */
function DirectionRow({ cue, density }: { cue: Cue; density: Density }) {
  return (
    <p
      className="flex items-baseline gap-1.5 font-mono text-[13px] leading-snug text-sky-300/70 motion-reduce:animate-none"
      style={{ animation: `vm-cue-in ${ENTER_MS}ms ease-out` }}
    >
      <span aria-hidden className="shrink-0 opacity-50">
        ›
      </span>
      <span className={density === "glance" ? "min-w-0 truncate" : "min-w-0"}>
        {toGlance(cue.text, DISPLAY_RULES[density].maxWords)}
      </span>
      {cue.resolved === false && (
        <span aria-hidden className="shrink-0 text-[10px] text-white/20">
          new
        </span>
      )}
    </p>
  );
}
