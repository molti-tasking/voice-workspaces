"use client";

import { Lock, MessageCircle, Pointer } from "lucide-react";
import { useEffect, useState } from "react";
import type { Floor } from "@/lib/recorder/floor-store";
import type { PokeResult } from "@/lib/talkback/use-talkback";

/**
 * The only controls on the screen during a drive, besides Stop: who may talk.
 *
 * LOCK — only they speak. The agent still hears everything (their words go
 * into its context, the title, the summary) but is never asked to reply, and
 * a reply in progress is cut off where it stands.
 * NORMAL — what there was before: the agent talks back when it has something.
 * POKE — one turn from the agent, now, in either mode: the way you nudge
 * somebody sitting next to you. Under Lock the lock stays on afterwards.
 *
 * Enforced in the container (`Floor` in apps/pipecat/bot.py), not asked of the
 * model, and every change is recorded as the container applied it. So the
 * toggle shows what the agent is UNDER: a choice it has not confirmed yet is
 * drawn as pending, because a lock that has been tapped and not applied is not
 * a lock.
 *
 * Big, and at the bottom where a thumb is. Two segments rather than a switch,
 * because a switch says on/off and these are two different ways of talking.
 */

/** How long what became of a poke stays under the button. */
const POKE_NOTE_MS = 2500;

const POKE_NOTES: Record<PokeResult, string> = {
  fired: "Poked",
  // They were mid-sentence: the agent answers when they finish.
  armed: "After you finish",
  running: "Coming",
  speaking: "It is already talking",
  ended: "The drive has ended",
};

export function FloorControls({
  floor,
  applied,
  connected,
  speaking,
  onFloor,
  onPoke,
}: {
  /** What the person chose. */
  floor: Floor;
  /** What the agent is under, as the container confirmed it. */
  applied: Floor | null;
  /** Talk-back is up: a request can reach the agent. */
  connected: boolean;
  /** The agent's audio is playing. */
  speaking: boolean;
  onFloor: (next: Floor) => void;
  onPoke: () => Promise<PokeResult | null>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [poking, setPoking] = useState(false);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), POKE_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  const pending = connected && applied !== floor;

  async function poke() {
    setPoking(true);
    try {
      const result = await onPoke();
      setNote(result ? POKE_NOTES[result] : "Could not reach it");
    } finally {
      setPoking(false);
    }
  }

  return (
    <div className="flex shrink-0 items-stretch gap-3" role="group" aria-label="Who may talk">
      <div className="flex flex-1 rounded-2xl bg-fg/10 p-1">
        {/* Never disabled: it is the remembered choice, sent with the offer when
            the connection comes up — so setting it while that happens is
            exactly when it matters, before the opening line. */}
        <Segment
          active={floor === "locked"}
          pending={pending && floor === "locked"}
          onClick={() => onFloor("locked")}
          icon={<Lock size={18} aria-hidden />}
          label="Lock"
        />
        <Segment
          active={floor === "open"}
          pending={pending && floor === "open"}
          onClick={() => onFloor("open")}
          icon={<MessageCircle size={18} aria-hidden />}
          label="Normal"
        />
      </div>

      <div className="relative flex">
        <button
          type="button"
          onClick={() => void poke()}
          // Nothing to poke while it is already talking, and nobody to reach
          // without a connection.
          disabled={!connected || speaking || poking}
          className={[
            "flex min-w-24 cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 text-base font-medium",
            "bg-sky-400/20 text-sky-100 transition-transform active:scale-95 disabled:cursor-default disabled:opacity-40",
          ].join(" ")}
        >
          <Pointer size={20} aria-hidden />
          Poke
        </button>
        {note && (
          // Said once, briefly, above the button — never announced, the same
          // rule as everything else on this screen.
          <span className="pointer-events-none absolute -top-7 right-0 whitespace-nowrap rounded-full bg-fg/10 px-2.5 py-0.5 text-xs text-fg/75">
            {note}
          </span>
        )}
      </div>
    </div>
  );
}

function Segment({
  active,
  pending,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  pending: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl text-base font-medium transition-colors",
        active ? "bg-surface text-fg shadow-sm" : "text-fg/60 hover:text-fg/80",
        // Chosen, not yet confirmed by the agent.
        pending ? "animate-pulse" : "",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
