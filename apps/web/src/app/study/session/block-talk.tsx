"use client";

import { useEffect, useRef, useState } from "react";
import { SESSION_TIMINGS, type ConversationDisplay, type SessionTimings } from "@voicemural/shared";
import type { MirrorBullets } from "@voicemural/talkback";
import { useCapture } from "@/components/capture-provider";
import type { ConversationStore } from "@/lib/talkback/conversation";
import { DEMO_POINTS, DEMO_STEPS } from "@/lib/talkback/demo-conversation";
import type { SparkLedger } from "@/lib/talkback/spark-ledger";
import type { SparkRequest } from "@/lib/talkback/types";
import { useScriptedConversation } from "@/lib/talkback/use-scripted-conversation";
import type { PokeResult } from "@/lib/talkback/use-talkback";
import { ErrorLine, PrimaryButton, StudyFrame } from "../../p/ui";
import { ConversationDisplay as Display } from "../../record/conversation-display";
import type { FlowStatus } from "../../record/conversation-flow";
import { SparkChips } from "../../record/spark-chips";
import { clock, spokenDuration } from "./session-copy";
import type { SessionBlockView, SendStep } from "./session-flow";

/**
 * One block's conversation: the task at the top with a timer and Finish, the
 * block's view of the conversation under it, and — in the column view — the
 * sparks row, exactly as on the recorder. Nothing else: no floor controls, no
 * renaming, no drafts, no Keep. Every control the four views do not all have
 * would be a difference between them that is not the view.
 *
 * Live, it is the recorder the whole app uses (`useCapture`). The walkthrough
 * (`?demo=1`) plays the simulated conversation instead, with no microphone,
 * no AI and nothing saved.
 */

const LINKED_RETRY_MS = 2_000;
const LINKED_TRIES = 15;
const SAVE_TRIES = 5;

export function LiveTalk({
  block,
  eyebrow,
  timings,
  send,
  onFinished,
  onFailed,
}: {
  block: SessionBlockView;
  eyebrow: string;
  timings: SessionTimings;
  send: SendStep;
  onFinished: () => void;
  onFailed: () => void;
}) {
  const { recorder: rec, talkback: talk, conversation, sparks, poke, isRecording, isBusy, stopRecording } = useCapture();
  const [stopping, setStopping] = useState(false);
  const [unlinked, setUnlinked] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  /** Bumped by Try again, so a failed save is sent once more. */
  const [saveRound, setSaveRound] = useState(0);
  const finishing = useRef(false);
  /** How long it has run, for the cap's timer to start from. */
  const ran = useRef(0);

  const hearing = talk.status === "speaking";
  const connected = talk.status === "listening" || talk.status === "speaking";
  // The server's word, once the drive is registered; the block's until then.
  // The two differ only when the drive is not the block's, which `linked`
  // below catches.
  const display = rec.display ?? block.display;
  const elapsed = rec.elapsedMs;

  // Make sure the drive is this block's before carrying on with it: the arm
  // can expire, or a second tab can take it. The registration can land after
  // the first ask, so retry.
  const sessionId = rec.currentSessionId;
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let tries = 0;
    const ask = async () => {
      if (cancelled) return;
      tries += 1;
      const body = (await send({ step: "linked", position: block.position, captureSessionId: sessionId })) as {
        linked?: boolean;
      } | null;
      if (cancelled || body?.linked) return;
      if (tries < LINKED_TRIES) window.setTimeout(() => void ask(), LINKED_RETRY_MS);
      else setUnlinked(true);
    };
    void ask();
    return () => {
      cancelled = true;
    };
  }, [sessionId, block.position, send]);

  // A conversation the server does not count is stopped, not carried on.
  useEffect(() => {
    if (unlinked && isRecording) stopRecording();
  }, [unlinked, isRecording, stopRecording]);

  // It ends by itself at the cap, as if they had tapped Finish.
  useEffect(() => {
    ran.current = elapsed;
  }, [elapsed]);
  useEffect(() => {
    if (!isRecording || stopping) return;
    const timer = window.setTimeout(
      () => {
        setStopping(true);
        stopRecording();
      },
      Math.max(0, timings.talkCapMs - ran.current),
    );
    return () => window.clearTimeout(timer);
  }, [isRecording, stopping, timings.talkCapMs, stopRecording]);

  // Finished once they asked for it and the last chunk is out of the recorder.
  useEffect(() => {
    if (!stopping || unlinked || isRecording || rec.status !== "idle" || finishing.current) return;
    finishing.current = true;
    void (async () => {
      for (let i = 0; i < SAVE_TRIES; i++) {
        if (await send({ step: "finished", position: block.position })) return onFinished();
        await new Promise((r) => window.setTimeout(r, LINKED_RETRY_MS));
      }
      finishing.current = false;
      setSaveFailed(true);
    })();
  }, [stopping, unlinked, isRecording, rec.status, block.position, send, onFinished, saveRound]);

  if (unlinked) {
    return (
      <StudyFrame eyebrow={eyebrow} title="This conversation did not start properly">
        <p>Nothing is lost. Please start it again.</p>
        <PrimaryButton disabled={isRecording || isBusy} onClick={onFailed}>
          Start again
        </PrimaryButton>
      </StudyFrame>
    );
  }
  if (saveFailed) {
    return (
      <StudyFrame eyebrow={eyebrow} title="That did not save">
        <p>Your conversation is recorded. Please check your connection and try again.</p>
        <PrimaryButton
          onClick={() => {
            setSaveFailed(false);
            setSaveRound((n) => n + 1);
          }}
        >
          Try again
        </PrimaryButton>
      </StudyFrame>
    );
  }
  // The microphone failed before or during the conversation.
  if (rec.error && !isRecording && !stopping) {
    return (
      <StudyFrame eyebrow={eyebrow} title="The recording stopped">
        <ErrorLine>{rec.error}</ErrorLine>
        <PrimaryButton onClick={onFailed}>Start again</PrimaryButton>
      </StudyFrame>
    );
  }

  return (
    <TalkScreen
      eyebrow={eyebrow}
      block={block}
      display={display}
      elapsedMs={isRecording ? elapsed : null}
      timings={timings}
      degraded={talk.status === "degraded"}
      finishing={stopping || isBusy}
      onFinish={() => {
        setStopping(true);
        stopRecording();
      }}
      store={conversation}
      status={
        isRecording
          ? {
              floor: connected ? (talk.floor ?? "open") : null,
              speaking: hearing,
              listening: !hearing && Boolean(talk.userSpeaking),
            }
          : null
      }
      sparks={rec.sparksArm ? sparks : null}
      live={isRecording}
      captureSessionId={sessionId}
      connected={connected}
      speaking={hearing}
      canPull={isRecording && connected && !hearing}
      onPull={poke}
    />
  );
}

/** The walkthrough: the simulated conversation, played as fast as the timings are. */
export function DemoTalk({
  block,
  eyebrow,
  timings,
  onFinished,
}: {
  block: SessionBlockView;
  eyebrow: string;
  timings: SessionTimings;
  onFinished: () => void;
}) {
  const speed = SESSION_TIMINGS.talkMinMs / Math.max(1, timings.talkMinMs);
  const { store, ledger, pull } = useScriptedConversation({ steps: DEMO_STEPS, speed });
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = now - started;
  const ended = useRef(false);
  const finish = () => {
    if (ended.current) return;
    ended.current = true;
    onFinished();
  };

  // It ends by itself at the cap, as a live one does.
  useEffect(() => {
    if (elapsed >= timings.talkCapMs && !ended.current) {
      ended.current = true;
      onFinished();
    }
  }, [elapsed, timings.talkCapMs, onFinished]);

  return (
    <TalkScreen
      eyebrow={eyebrow}
      block={block}
      display={block.display}
      elapsedMs={elapsed}
      timings={timings}
      degraded={false}
      finishing={false}
      onFinish={finish}
      store={store}
      status={null}
      // As on a drive: the control has no sparks.
      sparks={block.display === "transcript" ? null : ledger}
      live
      captureSessionId={null}
      fixedPoints={DEMO_POINTS}
      connected
      speaking={false}
      canPull
      onPull={pull}
    />
  );
}

function TalkScreen({
  eyebrow,
  block,
  display,
  elapsedMs,
  timings,
  degraded,
  finishing,
  onFinish,
  store,
  status,
  sparks,
  live,
  captureSessionId,
  fixedPoints,
  connected,
  speaking,
  canPull,
  onPull,
}: {
  eyebrow: string;
  block: SessionBlockView;
  display: ConversationDisplay;
  /** Null until the recording runs. */
  elapsedMs: number | null;
  timings: SessionTimings;
  degraded: boolean;
  finishing: boolean;
  onFinish: () => void;
  store: ConversationStore;
  status: FlowStatus | null;
  sparks: SparkLedger | null;
  live: boolean;
  captureSessionId: string | null;
  fixedPoints?: ReadonlyMap<string, MirrorBullets>;
  connected: boolean;
  speaking: boolean;
  canPull: boolean;
  onPull: (spark: SparkRequest) => Promise<PokeResult | null>;
}) {
  const canFinish = elapsedMs !== null && elapsedMs >= timings.talkMinMs && !finishing;
  const hint =
    elapsedMs === null
      ? "Opening the microphone…"
      : degraded
        ? "The assistant is not reachable right now. Keep talking; it reconnects by itself."
        : elapsedMs < timings.talkMinMs
          ? `You can finish after ${spokenDuration(timings.talkMinMs)}.`
          : elapsedMs >= timings.talkTargetMs
            ? "You can finish whenever you are ready."
            : `You can finish now, or keep going to about ${spokenDuration(timings.talkTargetMs)}.`;

  return (
    <main className="no-touch-fuss mx-auto flex h-dvh w-full max-w-2xl flex-col gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <header className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-fg/55 uppercase">{eyebrow}</p>
          <p className="truncate font-semibold">{block.task.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm text-fg/60" aria-live="off">
            {elapsedMs === null ? "…" : clock(elapsedMs)}
          </span>
          <button
            type="button"
            disabled={!canFinish}
            onClick={onFinish}
            className="min-h-10 cursor-pointer rounded-xl bg-fg px-4 text-sm font-semibold text-canvas disabled:cursor-not-allowed disabled:opacity-40"
          >
            {finishing ? "Saving…" : "Finish"}
          </button>
        </div>
      </header>

      {/* The same for every view: the task, folded, one tap away. */}
      <details className="shrink-0 rounded-xl bg-fg/[0.04] px-3 py-2 text-sm">
        <summary className="cursor-pointer text-fg/70">The task</summary>
        <p className="mt-2 leading-relaxed text-fg/85">{block.task.brief}</p>
        <ul className="mt-1.5 space-y-0.5 text-fg/65">
          {block.task.prompts.map((p) => (
            <li key={p} className="flex gap-1.5">
              <span aria-hidden>·</span>
              {p}
            </li>
          ))}
        </ul>
      </details>
      <p className="shrink-0 text-sm text-fg/55">{hint}</p>

      <Display
        display={display}
        store={store}
        status={status}
        sparks={sparks}
        live={live}
        captureSessionId={captureSessionId}
        canPull={canPull}
        onPull={onPull}
        fixedPoints={fixedPoints}
        placeholder={live ? "Talk whenever you are ready." : undefined}
        flow={{ drafts: [] }}
        className="min-h-0 flex-1"
      />

      {display === "conversation" && sparks && (
        <SparkChips store={store} ledger={sparks} connected={connected} speaking={speaking} onPull={onPull} />
      )}
    </main>
  );
}
