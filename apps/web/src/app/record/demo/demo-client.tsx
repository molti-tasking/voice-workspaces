"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createConversationStore } from "@/lib/talkback/conversation";
import { DEMO_POINTS, DEMO_STEPS, demoSparkQuestion } from "@/lib/talkback/demo-conversation";
import { createSparkLedger } from "@/lib/talkback/spark-ledger";
import type { SparkRequest } from "@/lib/talkback/types";
import type { PokeResult } from "@/lib/talkback/use-talkback";
import { ConversationFlow } from "../conversation-flow";
import { ConversationMirror } from "../conversation-mirror";
import { SparkChips } from "../spark-chips";
import { ViewSwitch, useRecordView } from "../view-switch";

/** How long the scripted agent takes to ask a pulled spark. */
const SPARK_REPLY_MS = 900;

export function DemoClient() {
  // Restart is a fresh run: a new store, a new ledger, from the first step.
  const [run, setRun] = useState(0);
  return <DemoRun key={run} onRestart={() => setRun((n) => n + 1)} />;
}

function DemoRun({ onRestart }: { onRestart: () => void }) {
  const [store] = useState(createConversationStore);
  const [ledger] = useState(createSparkLedger);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const view = useRecordView();
  const done = step >= DEMO_STEPS.length;

  // Play the script: each message after its pause, as the voice container
  // would send it, and the sparks worked out after each, as on a drive.
  useEffect(() => {
    if (paused || done) return;
    const next = DEMO_STEPS[step]!;
    const timer = window.setTimeout(() => {
      store.dispatch(next.message);
      ledger.refresh(store.getSnapshot(), Date.now());
      setStep((n) => n + 1);
    }, next.waitMs);
    return () => window.clearTimeout(timer);
  }, [step, paused, done, store, ledger]);

  // A pulled spark is asked by the scripted agent, a moment later.
  async function pull(spark: SparkRequest): Promise<PokeResult | null> {
    const topic = store.getSnapshot().sections.find((s) => s.ordinal === spark.ordinal)?.title ?? "this";
    const question = spark.question ?? demoSparkQuestion(spark.kind, topic);
    window.setTimeout(() => {
      store.dispatch({ type: "agent", id: `spark-${spark.ordinal}-${spark.kind}`, text: question });
      ledger.refresh(store.getSnapshot(), Date.now());
    }, SPARK_REPLY_MS);
    return "fired";
  }

  return (
    <main className="no-touch-fuss mx-auto flex h-dvh w-full max-w-5xl flex-col gap-3 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-xs text-amber-800 dark:text-amber-300">
          Simulated
        </span>
        <div className="flex items-center gap-2">
          {!done && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Play" : "Pause"}
              className="grid size-11 cursor-pointer place-items-center rounded-full bg-fg/10 text-fg/80 hover:bg-fg/20"
            >
              {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
            </button>
          )}
          <button
            type="button"
            onClick={onRestart}
            aria-label="Start again"
            className="grid size-11 cursor-pointer place-items-center rounded-full bg-fg/10 text-fg/80 hover:bg-fg/20"
          >
            <RotateCcw size={16} aria-hidden />
          </button>
        </div>
      </header>
      <p className="shrink-0 text-xs leading-snug text-fg/60">
        Test data: a scripted conversation played back — no microphone, no AI, nothing saved.{" "}
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
