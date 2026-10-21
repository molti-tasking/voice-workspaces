"use client";

import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { DEMO_POINTS, DEMO_STEPS } from "@/lib/talkback/demo-conversation";
import { createDemoVoice } from "@/lib/talkback/demo-voice";
import { useScriptedConversation } from "@/lib/talkback/use-scripted-conversation";
import { ConversationDisplay } from "../conversation-display";
import { SparkChips } from "../spark-chips";
import { ViewSwitch, useRecordView } from "../view-switch";

/** Whether this browser can speak: false on the server, so the first render agrees with it. */
function useCanSpeak(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => "speechSynthesis" in window,
    () => false,
  );
}

function noSubscription(): () => void {
  return () => undefined;
}

export function DemoClient() {
  // Restart is a fresh run: a new store, a new ledger, from the first step.
  const [run, setRun] = useState(0);
  // Sound survives a restart: it was asked for once.
  const [sound, setSound] = useState(false);
  const [voice] = useState(createDemoVoice);
  return (
    <DemoRun
      key={run}
      voice={voice}
      sound={sound}
      onSound={(on) => {
        if (on) voice.unlock();
        else voice.cancel();
        setSound(on);
      }}
      onRestart={() => {
        voice.cancel();
        setRun((n) => n + 1);
      }}
    />
  );
}

function DemoRun({
  voice,
  sound,
  onSound,
  onRestart,
}: {
  voice: ReturnType<typeof createDemoVoice>;
  sound: boolean;
  onSound: (on: boolean) => void;
  onRestart: () => void;
}) {
  const [paused, setPaused] = useState(false);
  // All four displays, the display study's plain transcript among them.
  const view = useRecordView({ withTranscript: true });
  const canSpeak = useCanSpeak();
  // The script, played as the voice container would send it; with sound, each
  // spoken line is waited out before the next one comes.
  const { store, ledger, done, pull } = useScriptedConversation({ steps: DEMO_STEPS, paused, voice, sound });

  const control =
    "grid size-11 cursor-pointer place-items-center rounded-full bg-fg/10 text-fg/80 hover:bg-fg/20";

  return (
    <main className="no-touch-fuss mx-auto flex h-dvh w-full max-w-5xl flex-col gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-xs text-amber-800 dark:text-amber-300">
          Simulated
        </span>
        <div className="flex items-center gap-2">
          {canSpeak && (
            <button
              type="button"
              onClick={() => onSound(!sound)}
              aria-pressed={sound}
              aria-label="Sound"
              className={[control, sound ? "ring-2 ring-accent/60" : ""].join(" ")}
            >
              {sound ? <Volume2 size={16} aria-hidden /> : <VolumeX size={16} aria-hidden />}
            </button>
          )}
          {!done && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Play" : "Pause"}
              className={control}
            >
              {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
            </button>
          )}
          <button type="button" onClick={onRestart} aria-label="Start again" className={control}>
            <RotateCcw size={16} aria-hidden />
          </button>
        </div>
      </header>
      <p className="shrink-0 text-xs leading-snug text-fg/60">
        Test data: a scripted conversation played back{canSpeak ? ", spoken by the browser if you turn the sound on" : ""} — no
        microphone, no AI, nothing saved.{" "}
        <Link href="/record" className="underline underline-offset-2 hover:text-fg">
          Back to the recorder
        </Link>
      </p>

      <ViewSwitch view={view} withTranscript />

      <ConversationDisplay
        display={view}
        store={store}
        status={null}
        // As on a drive: the control has no sparks.
        sparks={view === "transcript" ? null : ledger}
        live={!done}
        captureSessionId={null}
        canPull
        onPull={pull}
        fixedPoints={DEMO_POINTS}
        flow={{ drafts: [] }}
        className="min-h-0 flex-1"
      />

      {view === "conversation" && (
        <SparkChips store={store} ledger={ledger} connected speaking={false} onPull={pull} explainEmpty />
      )}
    </main>
  );
}
