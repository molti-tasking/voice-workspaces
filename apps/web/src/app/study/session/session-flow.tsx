"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  SessionCompletion,
  SessionProlific,
  SessionResume,
  SessionStep,
  SessionTimings,
} from "@voicemural/shared";
import { useCapture } from "@/components/capture-provider";
import { signIn } from "@/lib/auth-client";
import type { SessionBlockView } from "@/lib/study/session-view";
import { VOICE_ENGINE } from "@/lib/talkback/use-talkback";
import { MicCheck } from "../../p/mic-check";
import { Completion, ErrorLine, PrimaryButton, StudyFrame } from "../../p/ui";
import { DemoTalk, LiveTalk } from "./block-talk";
import { FinalQuestions } from "./final-questions";
import { PostBlock } from "./post-block";
import { DISPLAY_COPY, spokenDuration } from "./session-copy";
import { TicTacToe } from "./tic-tac-toe";

/**
 * The display study's session, in the browser: consent → microphone → how
 * it works → one practice round of the game → the brief → the conversation →
 * its questions → the last questions → done.
 *
 * The conversation's view and task come from the server: fixed when an
 * invite was made, or — for a participant from Prolific — when they consent,
 * in the setup that is running. The page only walks through them. Each step
 * it tells the server about is first-one-stands there, so a reload picks up
 * where the server says (`resumeAt`) and never records anything twice.
 *
 * `demo` is the walkthrough (`?demo=1`): the same pages, with the simulated
 * conversation instead of the microphone and nothing sent anywhere.
 */

export type { SessionBlockView } from "@/lib/study/session-view";

/** How a live session was opened: an invite's code, or a participant from Prolific. */
export type SessionEntry = { code: string } | { prolific: SessionProlific };

/** One step to the server; the reply's body, or null when it did not go through. */
export type SendStep = (
  step: SessionStep,
) => Promise<Record<string, unknown> | null>;

type Step =
  | { at: "consent" }
  | { at: "mic"; then: SessionResume }
  | { at: "intro" }
  | { at: "practice" }
  | { at: "brief" | "talk" | "answers" }
  | { at: "final" }
  | { at: "done" };

/**
 * Where a resumed session opens. A conversation interrupted by a reload
 * starts over, from how it works and the practice game.
 */
function stepFor(resume: SessionResume): Step {
  switch (resume.at) {
    case "consent":
      return { at: "consent" };
    case "brief":
      return { at: "intro" };
    case "answers":
      return { at: "answers" };
    case "final":
      return { at: "final" };
    case "done":
      return { at: "done" };
  }
}

export function SessionFlow({
  mode,
  entry,
  hasAccount,
  resume,
  block: initialBlock,
  completion: initialCompletion = null,
  timings,
  talkbackEnabled,
}: {
  mode: "live" | "demo";
  /** How it was opened; absent in the walkthrough. */
  entry?: SessionEntry;
  hasAccount: boolean;
  resume: SessionResume;
  /** The session's one conversation; null until a participant from Prolific has consented. */
  block: SessionBlockView | null;
  /** A finished Prolific participant's code, when the page opens on the end. */
  completion?: SessionCompletion | null;
  timings: SessionTimings;
  talkbackEnabled: boolean;
}) {
  const [step, setStep] = useState<Step>(() =>
    resume.at === "brief" ? { at: "mic", then: resume } : stepFor(resume),
  );
  const [block, setBlock] = useState(initialBlock);
  const [completion, setCompletion] = useState(initialCompletion);
  const fromProlific = entry !== undefined && "prolific" in entry;

  const send = useCallback<SendStep>(
    async (body) => {
      if (mode === "demo") return { ok: true, linked: true };
      const res = await fetch("/api/study-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res?.ok) return null;
      return (
        ((await res.json().catch(() => null)) as Record<
          string,
          unknown
        > | null) ?? {}
      );
    },
    [mode],
  );

  const go = useCallback((next: Step) => {
    setStep(next);
    window.scrollTo({ top: 0 });
  }, []);
  const onTalkFinished = useCallback(() => go({ at: "answers" }), [go]);

  if (mode === "live" && !talkbackEnabled) {
    return (
      <StudyFrame title="The conversation is not available in this build">
        <p>
          Set <code>NEXT_PUBLIC_TALKBACK_ENABLED=true</code> and{" "}
          <code>TALKBACK_ENABLED=true</code>, run the voice container, and
          rebuild.
        </p>
      </StudyFrame>
    );
  }

  if (step.at === "consent") {
    return (
      <Consent
        mode={mode}
        entry={entry}
        hasAccount={hasAccount}
        onEnrolled={(at, assigned) => {
          if (assigned) setBlock(assigned);
          // The walkthrough has no microphone to check.
          go(mode === "demo" ? stepFor(at) : { at: "mic", then: at });
        }}
      />
    );
  }
  if (step.at === "done") {
    return fromProlific ? (
      <Completion
        code={completion?.code ?? null}
        url={completion?.url ?? null}
      />
    ) : (
      <StudyFrame title="Thank you, you are done">
        <p>Your answers are saved. You can close this page.</p>
        {mode === "demo" && (
          <p className="text-sm text-fg/60">
            This was the walkthrough: nothing was recorded or saved.
          </p>
        )}
      </StudyFrame>
    );
  }
  // Past consent there is always a block; a session that has none was not made properly.
  if (!block) {
    return (
      <StudyFrame title="This session could not be prepared">
        <p>Please reload the page.</p>
      </StudyFrame>
    );
  }
  const { position } = block;

  switch (step.at) {
    case "mic":
      return (
        <MicCheck
          eyebrow="Before you start"
          onReady={() => go(stepFor(step.then))}
        />
      );
    case "intro":
      return (
        <Intro timings={timings} onContinue={() => go({ at: "practice" })} />
      );
    case "practice":
      // Once, unhurried, so the first interruption is not also the first time
      // they see the game.
      return (
        <TicTacToe
          eyebrow="Before you start"
          title="Try the game"
          note="Once during the conversation, this game interrupts you for about a minute. Play one round now."
          minMs={0}
          capMs={PRACTICE_CAP_MS}
          onDone={() => go({ at: "brief" })}
        />
      );
    case "brief": {
      const start = () => go({ at: "talk" });
      return mode === "live" ? (
        <LiveBrief
          block={block}
          eyebrow={EYEBROW}
          send={send}
          onStart={start}
        />
      ) : (
        <Brief block={block} eyebrow={EYEBROW} ready onStart={start} />
      );
    }
    case "talk":
      return mode === "live" ? (
        <LiveTalk
          block={block}
          eyebrow={EYEBROW}
          timings={timings}
          send={send}
          onFinished={onTalkFinished}
          onFailed={() => go({ at: "brief" })}
        />
      ) : (
        <DemoTalk
          block={block}
          eyebrow={EYEBROW}
          timings={timings}
          onFinished={onTalkFinished}
        />
      );
    case "answers":
      return (
        <PostBlock
          eyebrow={EYEBROW}
          // Finish waits for the game, so the conversation has had one.
          hadGame
          onSubmit={async (answers) => {
            if (!(await send({ step: "answers", position, answers })))
              return false;
            go({ at: "final" });
            return true;
          }}
        />
      );
    case "final":
      return (
        <FinalQuestions
          fromProlific={fromProlific}
          onSubmit={async (final) => {
            const body = await send({ step: "final", final });
            if (!body) return false;
            if (body.completion)
              setCompletion(body.completion as SessionCompletion);
            go({ at: "done" });
            return true;
          }}
        />
      );
  }
}

/** Above the brief, the conversation and its questions. */
const EYEBROW = "Your conversation";

/* ------------------------------------------------------------------------- */

function Consent({
  mode,
  entry,
  hasAccount,
  onEnrolled,
}: {
  mode: "live" | "demo";
  entry?: SessionEntry;
  hasAccount: boolean;
  onEnrolled: (resume: SessionResume, block?: SessionBlockView) => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enrol() {
    if (mode === "demo" || !entry)
      return onEnrolled({ at: "brief", position: 0 });
    setBusy(true);
    setError(null);
    if (!hasAccount) {
      // A guest account: a real user behind a cookie, as on the landing page.
      const { error: guestError } = await signIn.anonymous();
      if (guestError) {
        setBusy(false);
        return setError(
          "Could not start the study in this browser. Please reload and try again.",
        );
      }
    }
    const res = await fetch("/api/study-session/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...entry, consent: true }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      resume?: SessionResume;
      block?: SessionBlockView;
      error?: string;
    } | null;
    setBusy(false);
    if (res?.ok && body?.resume) return onEnrolled(body.resume, body.block);
    switch (body?.error) {
      case "claimed_elsewhere":
        return setError(
          "This session was already started in another browser. Please carry on there.",
        );
      case "not_a_guest":
        return setError(
          "You are signed in to this app in this browser. Please open the link in a private window.",
        );
      case "other_session":
        return setError(
          "This browser was already used for another session of this study. Please open the link in a private window.",
        );
      case "closed":
        return setError(
          "This study is not open right now. Please return it on Prolific, and sorry for the trouble.",
        );
      case "unknown":
        return setError(
          "This link does not work any more. Please ask the researchers for a new one.",
        );
      default:
        return setError("Something went wrong. Please try again.");
    }
  }

  return (
    <StudyFrame title="A short conversation with a voice assistant">
      <p>
        In this study you talk with an AI voice assistant about an everyday
        planning problem for about five minutes, and answer a few questions
        afterwards. It takes about 15 minutes. You need your phone, a quiet
        place, and ideally headphones.
      </p>
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-5 text-[0.95rem]">
        <p className="font-medium">What we record and why</p>
        <ul className="list-disc space-y-1.5 pl-5 text-fg/80">
          <li>
            Your voice during the conversation is recorded and transcribed
            automatically. The transcripts, the assistant&apos;s replies, what
            you write afterwards and how you used the screen are stored for
            research.
          </li>
          <li>
            {VOICE_ENGINE === "realtime"
              ? "To run the conversation, your voice goes to OpenAI’s speech model, which hears what you say, transcribes it and speaks the assistant’s replies."
              : "To run the conversation, your speech is transcribed by Deepgram, the assistant’s replies are written by an AI model, and its voice is made by ElevenLabs."}{" "}
            Afterwards, the research team and an AI model hosted at the
            researchers&apos; university read the transcript and what you
            wrote, to study how a spoken conversation can be shown on a phone.
          </li>
          <li>
            You are known to us only by a code, not by name. Please do not
            mention your name or other personal details in the conversation.
            Results are published only in anonymised form.
          </li>
          <li>
            Taking part is voluntary. You can stop at any time by closing this
            page, and ask the researchers to delete your data.
          </li>
        </ul>
      </div>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 size-5 shrink-0"
        />
        <span>
          I have read the above, I am 18 or older, and I agree to take part.
        </span>
      </label>
      {error && <ErrorLine>{error}</ErrorLine>}
      <PrimaryButton disabled={!agreed || busy} onClick={() => void enrol()}>
        {busy ? "One moment…" : "Continue"}
      </PrimaryButton>
    </StudyFrame>
  );
}

function Intro({
  timings,
  onContinue,
}: {
  timings: SessionTimings;
  onContinue: () => void;
}) {
  return (
    <StudyFrame eyebrow="Before you start" title="How it works">
      <ul className="list-disc space-y-2 pl-5 text-fg/85">
        <li>
          You will have one short conversation with the assistant, about an
          everyday problem.
        </li>
        <li>
          Hold your phone as you normally would and talk out loud. The assistant
          answers when you pause.
        </li>
        <li>
          The assistant only talks: it cannot look anything up online, so it
          works from what it knows and what you tell it.
        </li>
        <li>
          The screen shows the conversation as it goes. Look at it as much or as
          little as you like.
        </li>
        <li>
          Once during the conversation, a short game takes over the screen for
          about a minute. When it ends, you are back in the conversation.
        </li>
        <li>
          You can finish the conversation after{" "}
          {spokenDuration(timings.talkMinMs)}. At{" "}
          {spokenDuration(timings.talkCapMs)} it ends by itself.
        </li>
        <li>
          Afterwards, you write two or three sentences about it and answer a few
          quick questions.
        </li>
        <li>Please do not take notes.</li>
      </ul>
      <PrimaryButton onClick={onContinue}>Continue</PrimaryButton>
    </StudyFrame>
  );
}

/** The practice round is one round; this only stops a page left open from waiting forever. */
const PRACTICE_CAP_MS = 3 * 60_000;

/** How often the brief renews its block's arm while they read. */
const REARM_MS = 10 * 60_000;

/**
 * The live brief: arms the block as it opens, so the tap on Start opens the
 * microphone straight away, and sets the drive up the way the study runs it —
 * in English, with the floor open, whatever this browser chose on /record.
 */
function LiveBrief({
  block,
  eyebrow,
  send,
  onStart,
}: {
  block: SessionBlockView;
  eyebrow: string;
  send: SendStep;
  onStart: () => void;
}) {
  const { chooseSttLanguage, startRecording, isBusy, floor, setFloor } =
    useCapture();
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    chooseSttLanguage("en");
  }, [chooseSttLanguage]);
  useEffect(() => {
    if (floor !== "open") setFloor("open");
  }, [floor, setFloor]);

  useEffect(() => {
    let cancelled = false;
    const arm = async () => {
      const ok = await send({ step: "arm", position: block.position });
      if (cancelled) return;
      setArmed(Boolean(ok));
      setFailed(!ok);
    };
    void arm();
    const timer = window.setInterval(() => void arm(), REARM_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [block.position, send]);

  return (
    <Brief
      block={block}
      eyebrow={eyebrow}
      ready={armed && !isBusy}
      error={
        failed
          ? "This conversation could not be prepared. Please reload the page."
          : null
      }
      onStart={() => {
        startRecording();
        onStart();
      }}
    />
  );
}

function Brief({
  block,
  eyebrow,
  ready,
  error,
  onStart,
}: {
  block: SessionBlockView;
  eyebrow: string;
  ready: boolean;
  error?: string | null;
  onStart: () => void;
}) {
  const copy = DISPLAY_COPY[block.display];
  return (
    <StudyFrame eyebrow={eyebrow} title={block.task.title}>
      <p>{block.task.brief}</p>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="mb-2 font-medium">Things you could think about</p>
        <ul className="list-disc space-y-1 pl-5 text-fg/80">
          {block.task.prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
      <p>While you talk, the screen shows {copy.brief}</p>
      {error && <ErrorLine>{error}</ErrorLine>}
      <PrimaryButton disabled={!ready} onClick={onStart}>
        Start the conversation
      </PrimaryButton>
    </StudyFrame>
  );
}
