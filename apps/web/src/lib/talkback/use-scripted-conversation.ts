"use client";

import { useEffect, useRef, useState } from "react";
import {
  createConversationStore,
  type ConversationMessage,
  type ConversationStore,
  type Speaker,
} from "./conversation";
import { demoSparkQuestion, type DemoStep } from "./demo-conversation";
import type { DemoVoice } from "./demo-voice";
import { heardOf } from "./realtime/events";
import { createSparkLedger, type SparkLedger } from "./spark-ledger";
import type { SparkRequest } from "./types";
import type { PokeResult } from "./use-talkback";

/** How long the scripted agent takes to ask a pulled spark. */
const SPARK_REPLY_MS = 900;
/** With sound, the pause after a spoken line: the line's own length did the waiting. */
const SPOKEN_GAP_MS = 500;
/** How often the agent's line being said catches up with its voice, as the realtime engine's does. */
const SAY_TICK_MS = 150;
/** Where a line starts: its first word or two already said, so it never shows as an empty bubble. */
const FIRST_WORDS_MS = 400;

/** A turn's message: the agent's, when it is being said. */
type AgentLine = Extract<ConversationMessage, { type: Speaker }>;

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
 *
 * The agent's lines are said as the realtime engine says them: the whole line
 * at once with how far its voice has got (`voiced`), at the same speaking
 * pace, so its words fade in where they will stay (lib/talkback/spoken.ts).
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
  /** The agent's line being said, and how much of its voice has played. */
  const saying = useRef<{ line: AgentLine; saidMs: number } | null>(null);

  // The line being said catches up with its voice; paused, it waits mid-sentence.
  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      const now = saying.current;
      if (!now) return;
      now.saidMs += SAY_TICK_MS * Math.max(1, speed);
      const voiced = heardOf(now.line.text, now.saidMs).length;
      if (voiced >= now.line.text.length) {
        saying.current = null;
        store.dispatch(now.line);
      } else {
        store.dispatch({ ...now.line, voiced });
      }
    }, SAY_TICK_MS);
    return () => window.clearInterval(timer);
  }, [paused, speed, store]);

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
          // Whatever was still being said is said: the next line comes.
          if (saying.current) store.dispatch(saying.current.line);
          saying.current = null;
          if (next.message.type === "agent") {
            const line = next.message;
            saying.current = { line, saidMs: FIRST_WORDS_MS };
            store.dispatch({ ...line, voiced: heardOf(line.text, FIRST_WORDS_MS).length });
          } else {
            store.dispatch(next.message);
          }
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
