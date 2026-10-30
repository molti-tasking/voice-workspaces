"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SESSION_TIMINGS, type ConversationDisplay, type SessionMoment, type SessionTimings } from "@voicemural/shared";
import type { ConversationDigest } from "@voicemural/talkback/digest";
import { useCapture } from "@/components/capture-provider";
import type { Conversation, ConversationStore } from "@/lib/talkback/conversation";
import { DEMO_STEPS, demoDigest } from "@/lib/talkback/demo-conversation";
import { useScriptedConversation } from "@/lib/talkback/use-scripted-conversation";
import { ErrorLine, PrimaryButton, StudyFrame } from "../../p/ui";
import { AgentNameProvider } from "../../record/agent-name-context";
import { ConversationView } from "../../record/views/conversation-view";
import type { FlowStatus } from "../../record/views/status-line";
import { useBlockMoments, type BlockMoments } from "./block-moments";
import { clock } from "./session-copy";
import type { SessionBlockView, SendStep } from "./session-flow";
import { TicTacToe } from "./tic-tac-toe";

/**
 * One block's conversation: the task at the top with a timer and Finish, and
 * the block's view of the conversation under it, exactly as on the recorder.
 * Nothing else: no floor controls, no renaming, no drafts, no Keep, no
 * sparks. Every control the views do not all have would be a difference
 * between them that is not the view.
 *
 * Once, between 2:15 and 3:00 (later only to let the agent finish), a game
 * interrupts it (`block-moments.ts`): the agent and the microphone are paused
 * and the game covers the screen; when it ends, the
 * conversation is back at once, with nothing in between. One-tap prompts
 * come in quiet moments. Finish waits for the game.
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
    // Working out a reply counts: the game must not land on one about to start.
    agentSpeaking: hearing || talk.thinking,
    timings,
    record: keep,
    pauseAgent,
    analytics: { captureSessionId: rec.currentSessionId },
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
        hidden={moments.phase === "game"}
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
                thinking: talk.thinking,
                lookingUp: talk.lookingUp,
              }
            : null
        }
        live={isRecording}
        captureSessionId={sessionId}
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
  const interrupted = moments.phase === "game";
  const { store } = useScriptedConversation({ steps: DEMO_STEPS, speed, paused: interrupted });
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
        block={block}
        display={block.display}
        elapsedMs={elapsed}
        timings={timings}
        degraded={false}
        finishing={false}
        onFinish={finish}
        store={store}
        status={null}
        live
        captureSessionId={null}
        fixedDigest={demoDigest}
      />
    </Interrupted>
  );
}

/**
 * The conversation with whatever interrupts it laid over it: the game over the
 * whole screen, the prompt over its bottom edge. The conversation stays
 * mounted underneath, so nothing it shows is rebuilt when it comes back.
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
          note="The conversation and the microphone are paused. Play until the bar is full."
          minMs={timings.gameMinMs}
          capMs={timings.gameCapMs}
          onDone={moments.gameDone}
        />
      )}
      {moments.phase === "back" && <ReturnShield />}
    </>
  );
}

/**
 * For a moment after the game, taps land on nothing. A round cut off by the
 * cap ends under a finger mid-move, and that tap would otherwise open
 * whatever the view has where the board was. The same in every view.
 */
const RETURN_SHIELD_MS = 600;

function ReturnShield() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setOn(false), RETURN_SHIELD_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return on ? <div aria-hidden className="fixed inset-0 z-50" /> : null;
}

function noop(): void {}

function TalkScreen({
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
  live,
  captureSessionId,
  fixedDigest,
}: {
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
  live: boolean;
  captureSessionId: string | null;
  fixedDigest?: (conversation: Conversation) => ConversationDigest;
}) {
  const canFinish = elapsedMs !== null && elapsedMs >= timings.talkMinMs && gameDone && !finishing;
  // When they can finish says the button itself; a line only for what it cannot say.
  const finishLabel = finishing
    ? "Saving…"
    : elapsedMs !== null && elapsedMs < timings.talkMinMs
      ? `Finish in ${clock(timings.talkMinMs - elapsedMs)}`
      : elapsedMs !== null && !gameDone
        ? "Finish after the game"
        : "Finish";
  // Solid once they reach the target: before it, finishing is allowed but not the suggestion.
  const atTarget = elapsedMs !== null && elapsedMs >= timings.talkTargetMs;
  const notice =
    elapsedMs === null
      ? "Opening the microphone…"
      : degraded
        ? "The assistant is not reachable right now. Keep talking; it reconnects by itself."
        : null;

  return (
    <main
      inert={hidden}
      aria-hidden={hidden || undefined}
      className="no-touch-fuss mx-auto flex h-dvh w-full max-w-2xl flex-col gap-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      {/*
        The study's own bar, apart from what is being tested: a tinted band
        edge to edge, small type, above the view. The task's name opens the
        task; the button says when they can finish.
      */}
      <header className="-mx-4 shrink-0 border-b border-line bg-fg/[0.05] px-4 py-2 text-sm">
        <div className="flex items-start justify-between gap-3">
          <details className="group min-w-0 flex-1">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 font-semibold text-fg/80 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">{block.task.title}</span>
              <ChevronDown size={15} aria-hidden className="shrink-0 text-fg/50 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-1 leading-relaxed text-fg/80">{block.task.brief}</p>
            <ul className="mt-1 mb-1 space-y-0.5 text-fg/60">
              {block.task.prompts.map((p) => (
                <li key={p} className="flex gap-1.5">
                  <span aria-hidden>·</span>
                  {p}
                </li>
              ))}
            </ul>
          </details>
          <button
            type="button"
            disabled={!canFinish}
            onClick={onFinish}
            className={`min-h-9 shrink-0 cursor-pointer rounded-lg border px-3 text-[13px] font-semibold tabular-nums disabled:cursor-not-allowed disabled:opacity-50 ${
              atTarget ? "border-fg bg-fg text-canvas" : "border-fg/25 text-fg/75"
            }`}
          >
            {finishLabel}
          </button>
        </div>
        {notice && <p className="pb-0.5 text-[13px] text-fg/60">{notice}</p>}
      </header>

      {/* No name for the agent: "Souffleur" is the field app's, and a named system is its researchers' own. */}
      <AgentNameProvider name="the assistant">
        <ConversationView
          view={display}
          store={store}
          status={status}
          live={live}
          captureSessionId={captureSessionId}
          {...(fixedDigest ? { fixedDigest } : {})}
          placeholder={live ? "Talk whenever you are ready." : undefined}
          // Not in the study: going back in time is a control only some
          // conversations would use, and the resumption is what is measured.
          timeBar={false}
          className="min-h-0 flex-1"
        />
      </AgentNameProvider>
    </main>
  );
}
