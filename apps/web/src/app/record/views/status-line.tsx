"use client";

import { Lock } from "lucide-react";
import type { Floor } from "@/lib/recorder/floor-store";
import { useAgentName } from "../agent-name-context";

/** Who has the floor this second, for the line under the conversation. */
export interface FlowStatus {
  /** As the agent is under it; null until something is connected. */
  floor: Floor | null;
  /** The agent is talking. Wins a tie: its own voice can reach the microphone. */
  speaking: boolean;
  /** They are talking. */
  listening: boolean;
}

/**
 * One line under the conversation: who has the floor this second. The one
 * thing on the screen worth catching from the corner of an eye, and the same
 * under every view, so the views differ in how they show the conversation and
 * in nothing else.
 */
export function StatusLine({ status }: { status: FlowStatus }) {
  const { floor, speaking, listening } = status;
  const agent = useAgentName();
  return (
    <p className="flex h-7 w-full shrink-0 items-center gap-2 text-sm text-fg/55 select-none">
      {speaking ? (
        <>
          <SpeakingBars />
          <span className="text-sky-700 dark:text-sky-300">{agent.Name} is speaking</span>
        </>
      ) : listening ? (
        <>
          <SpeakingBars />
          <span className="text-fg/80">Listening</span>
        </>
      ) : floor === "locked" ? (
        <>
          <Lock size={13} aria-hidden />
          <span>Locked: {agent.name} only talks when you poke it</span>
        </>
      ) : floor === null ? (
        <span>Connecting…</span>
      ) : (
        <span>Your turn</span>
      )}
    </p>
  );
}

/** Three bars rising and falling: someone is talking. Still, for reduced motion. */
function SpeakingBars() {
  return (
    <span className="vm-speaking flex h-3 items-end gap-[2px]" role="img" aria-label="speaking">
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
    </span>
  );
}
