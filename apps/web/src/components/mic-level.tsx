"use client";

import { useRef } from "react";
import { useMicLevel } from "@/lib/recorder/mic-level";

/**
 * The microphone's level, drawn inside a record button while it records.
 *
 * A pale disc that grows from the centre of the button as you speak and
 * shrinks back when you stop. Inside the button rather than around it, because
 * the halo outside already means something — "still going" on the dock, the
 * agent speaking on `/record` — and one ring carrying two signals would say
 * neither.
 *
 * Place it first inside a `relative` button and give the glyph `relative` too,
 * so the glyph paints over it.
 */
export function MicLevel() {
  const ref = useRef<HTMLSpanElement>(null);
  useMicLevel(ref);
  return (
    <span
      ref={ref}
      aria-hidden
      className="vm-mic-level pointer-events-none absolute inset-0 rounded-full"
    />
  );
}
