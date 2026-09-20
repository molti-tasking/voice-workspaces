"use client";

import { formatOffset } from "@voicemural/shared";

/**
 * That it is recording, said once and unmistakably.
 *
 * WHAT THIS FIXES. Every signal that a drive was running was a *modifier* of
 * something already on screen: the record button changed colour, a level meter
 * appeared inside it, the timer began to count. Each one reads as "on" only if
 * you know what "off" looked like a second ago — which a first-time
 * participant does not, and which Pilot 01 showed: they could not tell that
 * recording had started.
 *
 * So this is a thing that is either PRESENT or ABSENT. A red dot, the word,
 * and the elapsed time, in the one position on the screen that holds nothing
 * else. Nothing about it is a shade of something.
 *
 * THE DOT PULSES, and that is the load-bearing part. A static red dot is
 * indistinguishable from a decoration or a dead pixel; movement in peripheral
 * vision is the one visual signal that survives eyes being on the road, which
 * is the same argument the dock's breathing halo already makes.
 *
 * SPOKEN FOR SCREEN READERS, once per transition, through `role="status"`.
 * Mounting and unmounting the element is what announces it; that is also why
 * the caller renders it conditionally rather than passing a boolean.
 *
 * REDUCED MOTION is honoured by `vm-rec-dot` in globals.css — the dot holds
 * still and stays full strength, because the alternative to the pulse is not
 * "no signal", it is a solid one.
 */
export function RecordingBadge({
  elapsedMs,
  debriefing,
}: {
  elapsedMs: number;
  debriefing: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium",
        debriefing
          ? "bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/40"
          : "bg-red-500/15 text-red-100 ring-1 ring-red-400/40",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "vm-rec-dot size-2.5 rounded-full",
          debriefing ? "bg-amber-400" : "bg-red-500",
        ].join(" ")}
      />
      {/* The elapsed time is inside the badge rather than beside it: two
          numbers that mean "how long" in two places is one too many, and this
          is the one that is always on screen. */}
      <span>{debriefing ? "Debrief — still recording" : "Recording"}</span>
      <span className="font-mono tabular-nums opacity-70">{formatOffset(elapsedMs)}</span>
    </div>
  );
}
