"use client";

import { useEffect, useRef, useState } from "react";
import { createConversationStore, type ConversationMessage, type ConversationStore } from "./conversation";
import { demoSparkQuestion, type DemoStep } from "./demo-conversation";
import type { DemoVoice } from "./demo-voice";
import { createSparkLedger, type SparkLedger } from "./spark-ledger";
import type { SparkRequest } from "./types";
import type { PokeResult } from "./use-talkback";

/** How long the scripted agent takes to ask a pulled spark. */
const SPARK_REPLY_MS = 900;
/** With sound, the pause after a spoken line: the line's own length did the waiting. */
const SPOKEN_GAP_MS = 500;

function spokenLine(message: ConversationMessage): { text: string; who: "user" | "agent" } | null {
  return message.type === "user" || message.type === "agent" ? { text: message.text, who: message.type } : null;
}

/**
 * A scripted conversation played into a conversation store, as the voice
 * container would send it: each message after its pause, the sparks worked
 * out after each, and a pulled spark asked by the scripted agent a moment
 * later. For the simulated conversation (`/record/demo`) and the display
 * study's walkthrough (`/study/session?demo=1`), with no microphone and no AI.
 *
 * With a voice and `sound`, each spoken line is waited out before the next
 * comes, and pausing stops it mid-sentence. `speed` plays the pauses that
 * many times faster. Mount it again (a new `key`) to start over.
 */
export function useScriptedConversation({
  steps,
  paused = false,
  voice = null,
  sound = false,
  speed = 1,
}: {
  steps: readonly DemoStep[];
  paused?: boolean;
  voice?: DemoVoice | null;
  sound?: boolean;
  speed?: number;
}): {
  store: ConversationStore;
  ledger: SparkLedger;
  done: boolean;
  pull: (spark: SparkRequest) => Promise<PokeResult | null>;
} {
  const [store] = useState(createConversationStore);
  const [ledger] = useState(createSparkLedger);
  const [step, setStep] = useState(0);
  const done = step >= steps.length;
  /** The last step already shown, so a pause and play never shows it twice. */
  const shown = useRef(-1);
  /** The line being spoken, so play after a pause waits for it to finish. */
  const speaking = useRef<Promise<void> | null>(null);
  const speak = sound && voice !== null;

  useEffect(() => {
    if (paused || done) return;
    const next = steps[step]!;
    const fresh = shown.current < step;
    let cancelled = false;
    const wait = speak && step > 0 ? Math.min(next.waitMs, SPOKEN_GAP_MS) : next.waitMs / Math.max(1, speed);
    const timer = window.setTimeout(
      async () => {
        if (fresh) {
          shown.current = step;
          store.dispatch(next.message);
          ledger.refresh(store.getSnapshot(), Date.now());
          const line = spokenLine(next.message);
          if (speak && line) speaking.current = voice.speak(line.text, line.who);
        }
        await speaking.current;
        speaking.current = null;
        if (!cancelled) setStep((n) => n + 1);
      },
      fresh ? wait : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, paused, done, speak, speed, steps, store, ledger, voice]);

  // Pause stops the voice mid-sentence; play goes on from there.
  useEffect(() => {
    if (!voice) return;
    if (paused) voice.pause();
    else voice.resume();
  }, [paused, voice]);

  // Leaving silences it.
  useEffect(() => () => voice?.cancel(), [voice]);

  async function pull(spark: SparkRequest): Promise<PokeResult | null> {
    const topic = store.getSnapshot().sections.find((s) => s.ordinal === spark.ordinal)?.title ?? "this";
    const question = spark.question ?? demoSparkQuestion(spark.kind, topic);
    window.setTimeout(() => {
      store.dispatch({ type: "agent", id: `spark-${spark.ordinal}-${spark.kind}`, text: question });
      ledger.refresh(store.getSnapshot(), Date.now());
      if (speak) void voice.speak(question, "agent");
    }, SPARK_REPLY_MS);
    return "fired";
  }

  return { store, ledger, done, pull };
}
