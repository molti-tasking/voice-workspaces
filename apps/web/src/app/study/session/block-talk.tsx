"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SESSION_TIMINGS, type ConversationDisplay, type SessionMoment, type SessionTimings } from "@voicemural/shared";
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
import { useBlockMoments, type BlockMoments } from "./block-moments";
import { CarryOn, EsmPrompt, Probe } from "./interruption";
import { clock, spokenDuration } from "./session-copy";
import type { SessionBlockView, SendStep } from "./session-flow";
import { TicTacToe } from "./tic-tac-toe";

/**
 * One block's conversation: the task at the top with a timer and Finish, the
 * block's view of the conversation under it, and — in the column view — the
 * sparks row, exactly as on the recorder. Nothing else: no floor controls, no
 * renaming, no drafts, no Keep. Every control the four views do not all have
 * would be a difference between them that is not the view.
 *
 * Once, between 2:15 and 3:00, a game interrupts it (`block-moments.ts`):
 * the agent is paused, the game covers the screen, then they type where they
 * were, and are handed the conversation back. One-tap prompts come in quiet
 * moments. Finish waits for the game.
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
  const {
    recorder: rec,
    talkback: talk,
    conversation,
    sparks,
    poke,
    isRecording,
    isBusy,
    stopRecording,
    pauseAgent,
  } = useCapture();
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

  // The drive's own clock, the one its utterances and agent turns are on.
  const startedAt = rec.startedAt;
  const driveClock = useCallback(() => (startedAt === null ? null : Date.now() - startedAt), [startedAt]);
  const { position } = block;
  const keep = useCallback(
    (moment: SessionMoment) => {
      void (async () => {
        for (let i = 0; i < SAVE_TRIES; i++) {
          if (await send({ step: "moment", position, moment })) return;
          await new Promise((r) => window.setTimeout(r, LINKED_RETRY_MS));
        }
        console.warn("[study] a moment did not save", moment.kind, moment.ordinal);
      })();
    },
    [send, position],
  );
  const moments = useBlockMoments({
    active: isRecording && !stopping && !unlinked,
    clock: driveClock,
    userSpeaking: Boolean(talk.userSpeaking),
    agentSpeaking: hearing,
    timings,
    record: keep,
    pauseAgent,
  });
  const { flush } = moments;

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
        flush();
        setStopping(true);
        stopRecording();
      },
      Math.max(0, timings.talkCapMs - ran.current),
    );
    return () => window.clearTimeout(timer);
  }, [isRecording, stopping, timings.talkCapMs, stopRecording, flush]);

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
    <Interrupted eyebrow={eyebrow} timings={timings} moments={moments}>
      <TalkScreen
        gameDone={moments.phase === "back"}
        hidden={moments.phase !== "talk" && moments.phase !== "back"}
        eyebrow={eyebrow}
        block={block}
        display={display}
        elapsedMs={isRecording ? elapsed : null}
        timings={timings}
        degraded={talk.status === "degraded"}
        finishing={stopping || isBusy}
        onFinish={() => {
          flush();
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
    </Interrupted>
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
  const [started] = useState(() => Date.now());
  const demoClock = useCallback(() => Date.now() - started, [started]);
  const moments = useBlockMoments({
    active: true,
    clock: demoClock,
    userSpeaking: false,
    agentSpeaking: false,
    timings,
    // Nothing is saved in the walkthrough.
    record: noop,
    pauseAgent: noop,
  });
  const interrupted = moments.phase !== "talk" && moments.phase !== "back";
  const { store, ledger, pull } = useScriptedConversation({ steps: DEMO_STEPS, speed, paused: interrupted });
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = now - started;
  const ended = useRef(false);
  const { flush } = moments;
  const finish = () => {
    if (ended.current) return;
    ended.current = true;
    flush();
    onFinished();
  };

  // It ends by itself at the cap, as a live one does.
  useEffect(() => {
    if (elapsed >= timings.talkCapMs && !ended.current) {
      ended.current = true;
      flush();
      onFinished();
    }
  }, [elapsed, timings.talkCapMs, onFinished, flush]);

  return (
    <Interrupted eyebrow={eyebrow} timings={timings} moments={moments}>
      <TalkScreen
        gameDone={moments.phase === "back"}
        hidden={interrupted}
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
    </Interrupted>
  );
}

/**
 * The conversation with whatever interrupts it laid over it: the game, the
 * probe and the way back over the whole screen, the prompt over its bottom
 * edge. The conversation stays mounted underneath, so nothing it shows is
 * rebuilt when it comes back.
 */
function Interrupted({
  eyebrow,
  timings,
  moments,
  children,
}: {
  eyebrow: string;
  timings: SessionTimings;
  moments: BlockMoments;
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      {moments.phase === "game" && (
        <TicTacToe
          eyebrow={eyebrow}
          title="A quick game"
          note="The conversation is paused. Play until the bar is full."
          minMs={timings.gameMinMs}
          capMs={timings.gameCapMs}
          onDone={moments.gameDone}
        />
      )}
      {moments.phase === "probe" && <Probe eyebrow={eyebrow} onDone={moments.probeDone} />}
      {moments.phase === "carry_on" && <CarryOn eyebrow={eyebrow} onBack={moments.carryOn} />}
      {moments.prompt && (
        <EsmPrompt key={moments.prompt.slot.ordinal} item={moments.prompt.slot.item} onAnswer={moments.answerPrompt} />
      )}
    </>
  );
}

function noop(): void {}

function TalkScreen({
  eyebrow,
  block,
  display,
  elapsedMs,
  timings,
  degraded,
  finishing,
  gameDone,
  hidden,
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
  /** The game has been and gone: Finish may be offered. */
  gameDone: boolean;
  /** Something covers it: out of reach for taps and screen readers. */
  hidden: boolean;
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
  const canFinish = elapsedMs !== null && elapsedMs >= timings.talkMinMs && gameDone && !finishing;
  const hint =
    elapsedMs === null
      ? "Opening the microphone…"
      : degraded
        ? "The assistant is not reachable right now. Keep talking; it reconnects by itself."
        : elapsedMs < timings.talkMinMs
          ? `You can finish after ${spokenDuration(timings.talkMinMs)}.`
          : !gameDone
            ? "You can finish after the game."
            : elapsedMs >= timings.talkTargetMs
              ? "You can finish whenever you are ready."
              : `You can finish now, or keep going to about ${spokenDuration(timings.talkTargetMs)}.`;

  return (
    <main
      inert={hidden}
      aria-hidden={hidden || undefined}
      className="no-touch-fuss mx-auto flex h-dvh w-full max-w-2xl flex-col gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
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
