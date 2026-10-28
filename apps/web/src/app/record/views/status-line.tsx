"use client";

import { Lock } from "lucide-react";
import type { Floor } from "@/lib/recorder/floor-store";
import { useAgentName } from "../agent-name-context";

/** What the system is doing this second, for the line under the conversation. */
export interface FlowStatus {
  /** As the agent is under it; null until something is connected. */
  floor: Floor | null;
  /** The agent is talking. Wins a tie: its own voice can reach the microphone. */
  speaking: boolean;
  /** They are talking. */
  listening: boolean;
  /** Their turn is over and a reply is on its way. */
  thinking?: boolean;
  /** The agent is looking something up. */
  lookingUp?: boolean;
}

/**
 * One line under the conversation: what the system is doing this second —
 * listening to them, thinking, looking something up, speaking, or waiting for
 * them. The one thing on the screen worth catching from the corner of an eye,
 * and the same under every view, so the views differ in how they show the
 * conversation and in nothing else. Said from the system's side, in plain
 * words; the agent's name is not needed to say what it is doing.
 */
export function StatusLine({ status }: { status: FlowStatus }) {
  const { floor, speaking, listening, thinking = false, lookingUp = false } = status;
  const agent = useAgentName();
  return (
    <p className="flex h-7 w-full shrink-0 items-center gap-2 text-sm font-medium text-fg/60 select-none">
      {speaking ? (
        <>
          <SpeakingBars />
          <span className="text-sky-700 dark:text-sky-300">Speaking</span>
        </>
      ) : listening ? (
        <>
          <SpeakingBars className="text-viz-2" />
          <span className="text-orange-800 dark:text-orange-300">Listening to you</span>
        </>
      ) : lookingUp ? (
        <>
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-2 border-sky-700/25 border-t-sky-700 motion-reduce:animate-none dark:border-sky-300/25 dark:border-t-sky-300"
          />
          <span className="text-sky-700 dark:text-sky-300">Looking it up</span>
        </>
      ) : thinking ? (
        <>
          <span aria-hidden className="vm-thinking flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-current" />
            <span className="size-1.5 rounded-full bg-current" />
            <span className="size-1.5 rounded-full bg-current" />
          </span>
          <span>Thinking</span>
        </>
      ) : floor === "locked" ? (
        <>
          <Lock size={13} aria-hidden />
          <span>Locked: {agent.name} only talks when you poke it</span>
        </>
      ) : floor === null ? (
        <span>Connecting…</span>
      ) : (
        <>
          <span aria-hidden className="size-3 rounded-full border-2 border-current" />
          <span>Waiting for you</span>
        </>
      )}
    </p>
  );
}

/** Three bars rising and falling: someone is talking. Still, for reduced motion. */
function SpeakingBars({ className = "" }: { className?: string }) {
  return (
    <span className={`vm-speaking flex h-3 items-end gap-[2px] ${className}`} role="img" aria-label="speaking">
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
    </span>
  );
}
