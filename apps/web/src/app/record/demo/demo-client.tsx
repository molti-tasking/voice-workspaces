"use client";

import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createConversationStore, type ConversationMessage } from "@/lib/talkback/conversation";
import { DEMO_POINTS, DEMO_STEPS, demoSparkQuestion } from "@/lib/talkback/demo-conversation";
import { createDemoVoice } from "@/lib/talkback/demo-voice";
import { createSparkLedger } from "@/lib/talkback/spark-ledger";
import type { SparkRequest } from "@/lib/talkback/types";
import type { PokeResult } from "@/lib/talkback/use-talkback";
import { ConversationFlow } from "../conversation-flow";
import { ConversationMirror } from "../conversation-mirror";
import { SparkChips } from "../spark-chips";
import { ViewSwitch, useRecordView } from "../view-switch";

/** How long the scripted agent takes to ask a pulled spark. */
const SPARK_REPLY_MS = 900;
/** With sound, the pause after a spoken line: the line's own length did the waiting. */
const SPOKEN_GAP_MS = 500;

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

function spokenLine(message: ConversationMessage): { text: string; who: "user" | "agent" } | null {
  return message.type === "user" || message.type === "agent" ? { text: message.text, who: message.type } : null;
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
  const [store] = useState(createConversationStore);
  const [ledger] = useState(createSparkLedger);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const view = useRecordView();
  const canSpeak = useCanSpeak();
  const done = step >= DEMO_STEPS.length;
  /** The last step already shown, so a pause and play never shows it twice. */
  const shown = useRef(-1);
  /** The line being spoken, so play after a pause waits for it to finish. */
  const speaking = useRef<Promise<void> | null>(null);

  // Play the script: each message after its pause, as the voice container
  // would send it, and the sparks worked out after each, as on a drive. With
  // sound, a spoken line is waited out before the next one comes.
  useEffect(() => {
    if (paused || done) return;
    const next = DEMO_STEPS[step]!;
    const fresh = shown.current < step;
    let cancelled = false;
    const timer = window.setTimeout(
      async () => {
        if (fresh) {
          shown.current = step;
          store.dispatch(next.message);
          ledger.refresh(store.getSnapshot(), Date.now());
          const line = spokenLine(next.message);
          if (sound && line) speaking.current = voice.speak(line.text, line.who);
        }
        await speaking.current;
        speaking.current = null;
        if (!cancelled) setStep((n) => n + 1);
      },
      fresh ? (sound && step > 0 ? Math.min(next.waitMs, SPOKEN_GAP_MS) : next.waitMs) : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, paused, done, sound, store, ledger, voice]);

  // Pause stops the voice mid-sentence; play goes on from there.
  useEffect(() => {
    if (paused) voice.pause();
    else voice.resume();
  }, [paused, voice]);

  // Leaving the page silences it.
  useEffect(() => () => voice.cancel(), [voice]);

  // A pulled spark is asked by the scripted agent, a moment later.
  async function pull(spark: SparkRequest): Promise<PokeResult | null> {
    const topic = store.getSnapshot().sections.find((s) => s.ordinal === spark.ordinal)?.title ?? "this";
    const question = spark.question ?? demoSparkQuestion(spark.kind, topic);
    window.setTimeout(() => {
      store.dispatch({ type: "agent", id: `spark-${spark.ordinal}-${spark.kind}`, text: question });
      ledger.refresh(store.getSnapshot(), Date.now());
      if (sound) void voice.speak(question, "agent");
    }, SPARK_REPLY_MS);
    return "fired";
  }

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

      <ViewSwitch view={view} />

      {view === "conversation" ? (
        <ConversationFlow
          store={store}
          live={!done}
          status={null}
          sparks={ledger}
          drafts={[]}
          className="min-h-0 flex-1"
        />
      ) : (
        <ConversationMirror
          store={store}
          sparks={ledger}
          layout={view}
          captureSessionId={null}
          fixedPoints={DEMO_POINTS}
          live={!done}
          canPull
          onPull={pull}
          className="min-h-0 flex-1"
        />
      )}

      {view === "conversation" && (
        <SparkChips store={store} ledger={ledger} connected speaking={false} onPull={pull} explainEmpty />
      )}
    </main>
  );
}
