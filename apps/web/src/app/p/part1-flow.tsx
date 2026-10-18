"use client";

import { useEffect, useRef, useState } from "react";
import {
  ATTENTION_AFTER,
  ATTENTION_ITEM,
  SUS_ITEMS,
  TLX_ITEMS,
  type ProlificArm,
  type ProlificQuestionnaire,
  type TlxKey,
} from "@voicemural/shared";
import { useCapture } from "@/components/capture-provider";
import { DraftMarkdown } from "@/components/draft-markdown";
import { signIn } from "@/lib/auth-client";
import { SparkChips } from "../record/spark-chips";
import { StudyConversation } from "./study-conversation";
import { Completion, ErrorLine, PrimaryButton, Scale, StudyFrame } from "./ui";

/**
 * Part 1, in the browser: consent → microphone → task → conversation → the
 * questionnaire (judgement of learning, raw NASA-TLX, SUS) → the completion
 * code.
 *
 * The conversation is the recorder the whole app uses (`useCapture`), with —
 * in the sparks arm only — the spark chips. No floor controls: Lock / Normal /
 * Poke are not what the study compares, and every extra control is variance
 * between participants. The floor stays open; a pulled spark still reaches
 * the agent through the poke request underneath. The arm reaches this page from the server twice over: from the
 * enrolment, for the instructions, and from the drive's frozen condition
 * (`recorder.sparksArm`), which is what actually shows the chips, exactly as
 * on `/record`.
 *
 * NOTHING HERE SUMMARISES THE CONVERSATION, and nothing asks them to recall
 * it: any retrieval before part 2 would be practice, and practice is what the
 * sparks arm is being compared on.
 */

interface Task {
  title: string;
  brief: string;
  prompts: string[];
  /** What the agent titles the plan draft (`StudyTask.planTitle`). */
  planTitle: string;
}

type Step = "consent" | "mic" | "brief" | "talk" | "questionnaire" | "done";

const STARTED_RETRY_MS = 2_000;
const STARTED_TRIES = 15;

export function Part1Flow({
  pid,
  studyId,
  sessionId,
  pinnedArm,
  hasAccount,
  enrolledArm,
  task,
  minMinutes,
  targetMinutes,
  talkbackEnabled,
}: {
  pid: string;
  studyId?: string;
  sessionId?: string;
  pinnedArm?: ProlificArm;
  hasAccount: boolean;
  /** Already enrolled in this browser: straight back to the task. */
  enrolledArm: ProlificArm | null;
  task: Task;
  minMinutes: number;
  targetMinutes: number;
  talkbackEnabled: boolean;
}) {
  const [step, setStep] = useState<Step>(enrolledArm ? "mic" : "consent");
  const [arm, setArm] = useState<ProlificArm | null>(enrolledArm);
  const [completion, setCompletion] = useState<{
    url: string | null;
    code: string | null;
  } | null>(null);

  if (!talkbackEnabled) {
    return (
      <StudyFrame title="The conversation is not available in this build">
        <p>
          Set <code>NEXT_PUBLIC_TALKBACK_ENABLED=true</code> and{" "}
          <code>TALKBACK_ENABLED=true</code>, run the voice container, and
          rebuild. See PROLIFIC.md.
        </p>
      </StudyFrame>
    );
  }

  switch (step) {
    case "consent":
      return (
        <Consent
          pid={pid}
          studyId={studyId}
          sessionId={sessionId}
          pinnedArm={pinnedArm}
          hasAccount={hasAccount}
          onEnrolled={(assigned) => {
            setArm(assigned);
            setStep("mic");
          }}
        />
      );
    case "mic":
      return <MicCheck onReady={() => setStep("brief")} />;
    case "brief":
      return (
        <Brief
          task={task}
          sparks={arm === "sparks"}
          minMinutes={minMinutes}
          targetMinutes={targetMinutes}
          onStart={() => setStep("talk")}
        />
      );
    case "talk":
      return (
        <Talk
          task={task}
          minMinutes={minMinutes}
          targetMinutes={targetMinutes}
          onFinished={() => setStep("questionnaire")}
          onFailed={() => setStep("brief")}
        />
      );
    case "questionnaire":
      return (
        <Questionnaire
          onDone={(result) => {
            setCompletion(result);
            setStep("done");
          }}
        />
      );
    case "done":
      return (
        <Completion
          part={1}
          url={completion?.url ?? null}
          code={completion?.code ?? null}
          next="Part 1 is complete. We will invite you to part 2 on Prolific in about a day. Please do not write anything down about the conversation, look the topic up or talk it over with anyone until then."
        />
      );
  }
}

/* ------------------------------------------------------------------------- */

function Consent({
  pid,
  studyId,
  sessionId,
  pinnedArm,
  hasAccount,
  onEnrolled,
}: {
  pid: string;
  studyId?: string;
  sessionId?: string;
  pinnedArm?: ProlificArm;
  hasAccount: boolean;
  onEnrolled: (arm: ProlificArm) => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enrol() {
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
    const res = await fetch("/api/prolific/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pid,
        studyId,
        sessionId,
        consent: true,
        arm: pinnedArm,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      arm?: ProlificArm;
      error?: string;
    } | null;
    setBusy(false);
    if (res?.ok && body?.arm) return onEnrolled(body.arm);
    if (body?.error === "enrolled_elsewhere") {
      return setError(
        "You already started this study in another browser. Please continue there.",
      );
    }
    if (body?.error === "not_a_guest") {
      return setError(
        "You are signed in to this app in this browser. Please open the study link in a private window.",
      );
    }
    if (body?.error === "other_participant") {
      return setError(
        "This browser was already used for this study with a different Prolific ID. Please open the study link in a private window.",
      );
    }
    setError("Something went wrong. Please try again.");
  }

  return (
    <StudyFrame
      eyebrow="Part 1 of 2"
      title="Thinking a problem through with a voice assistant"
    >
      <p>
        In this study you talk with an AI voice assistant about an everyday
        planning problem for about 15 minutes, then answer a few questions about
        it. About a day later we will invite you to a short follow-up (about 10
        minutes) with questions about your conversation. You need a microphone,
        and headphones are best.
      </p>
      <div className="space-y-3 rounded-2xl border border-line bg-surface p-5 text-[0.95rem]">
        <p className="font-medium">What we record and why</p>
        <ul className="list-disc space-y-1.5 pl-5 text-fg/80">
          <li>
            Your voice during the conversation is recorded and transcribed
            automatically. The transcript, the assistant&apos;s replies and how
            you used the buttons are stored for research.
          </li>
          <li>
            In part 2, what you write from memory and your answers are stored
            with your Prolific ID, so the two parts can be matched and you can
            be paid.
          </li>
          <li>
            Please do not mention your name or other personal details in the
            conversation. The data are used only for research, analysed by the
            research team, and published only in anonymised form.
          </li>
          <li>
            Taking part is voluntary. You can stop at any time by closing this
            page; message us on Prolific to have your data deleted.
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

/* ------------------------------------------------------------------------- */

/**
 * Ask for the microphone and show that it hears them, before anything else
 * depends on it. The stream is closed again: the recorder opens its own.
 */
function MicCheck({ onReady }: { onReady: () => void }) {
  const [state, setState] = useState<
    "idle" | "asking" | "listening" | "denied" | "unsupported"
  >("idle");
  const [heard, setHeard] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const stop = useRef<() => void>(() => undefined);

  useEffect(() => () => stop.current(), []);

  async function listen() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return setState("unsupported");
    }
    setState("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setState("denied");
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 8);
      if (bar.current) bar.current.style.width = `${Math.round(level * 100)}%`;
      if (level > 0.25) setHeard(true);
      frame = requestAnimationFrame(tick);
    };
    tick();
    stop.current = () => {
      cancelAnimationFrame(frame);
      stream.getTracks().forEach((t) => t.stop());
      void context.close().catch(() => undefined);
    };
    setState("listening");
  }

  return (
    <StudyFrame eyebrow="Part 1 of 2" title="Check your microphone">
      <p>
        Your browser will ask for permission to use the microphone. Then say a
        few words; the bar should move. Headphones help, so the assistant does
        not hear itself.
      </p>
      {state === "idle" || state === "asking" ? (
        <PrimaryButton
          disabled={state === "asking"}
          onClick={() => void listen()}
        >
          Turn on microphone
        </PrimaryButton>
      ) : state === "denied" ? (
        <ErrorLine>
          The microphone was blocked. Allow it in your browser&apos;s address
          bar, then reload this page.
        </ErrorLine>
      ) : state === "unsupported" ? (
        <ErrorLine>
          This browser cannot record audio. Please use a current Chrome, Edge or
          Firefox.
        </ErrorLine>
      ) : (
        <>
          <div
            className="h-4 w-full overflow-hidden rounded-full bg-fg/10"
            aria-hidden
          >
            <div
              ref={bar}
              className="h-full w-0 rounded-full bg-emerald-500 transition-[width] duration-75"
            />
          </div>
          <p className="text-sm text-fg/60">
            {heard ? "We can hear you." : "Say something…"}
          </p>
          <PrimaryButton
            disabled={!heard}
            onClick={() => {
              stop.current();
              onReady();
            }}
          >
            Continue
          </PrimaryButton>
        </>
      )}
    </StudyFrame>
  );
}

/* ------------------------------------------------------------------------- */

function Brief({
  task,
  sparks,
  minMinutes,
  targetMinutes,
  onStart,
}: {
  task: Task;
  sparks: boolean;
  minMinutes: number;
  targetMinutes: number;
  onStart: () => void;
}) {
  const { chooseSttLanguage, startRecording, isBusy, floor, setFloor } = useCapture();

  // The study runs in English, whatever this browser chose before. Set now,
  // a render before Start, so the drive opens with it.
  useEffect(() => {
    chooseSttLanguage("en");
  }, [chooseSttLanguage]);

  // And with the floor open: there is no Lock on this page to undo a lock
  // this browser remembers from /record. Only when it differs — the choice
  // is stored per browser.
  useEffect(() => {
    if (floor !== "open") setFloor("open");
  }, [floor, setFloor]);

  return (
    <StudyFrame eyebrow="Part 1 of 2" title={task.title}>
      <p>{task.brief}</p>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="mb-2 font-medium">Things you could think about</p>
        <ul className="list-disc space-y-1 pl-5 text-fg/80">
          {task.prompts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
      <div className="space-y-2 text-[0.95rem] text-fg/80">
        <p className="font-medium text-fg">How it works</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Talk out loud. The assistant, called Souffleur, listens and answers
            when you pause. The screen shows the topics you have talked about
            and its last few replies.
          </li>
          <li>
            Your plan builds up on the right. Whenever you have decided
            something, say <strong>&ldquo;put that on the plan&rdquo;</strong>.
            You can finish once the plan holds your three measures.
          </li>
          {sparks && (
            <li>
              Now and then, question cards appear at the bottom of your side of
              the screen. Tap one whenever you want the assistant to ask you
              that question.
            </li>
          )}
          <li>
            Please talk for about {targetMinutes} minutes.
            {minMinutes > 0 && ` You can finish after ${minMinutes} minutes.`}
          </li>
          <li>Please do not take notes, now or afterwards.</li>
        </ul>
      </div>
      <PrimaryButton
        disabled={isBusy}
        onClick={() => {
          startRecording();
          onStart();
        }}
      >
        Start the conversation
      </PrimaryButton>
    </StudyFrame>
  );
}

/* ------------------------------------------------------------------------- */

function Talk({
  task,
  minMinutes,
  targetMinutes,
  onFinished,
  onFailed,
}: {
  task: Task;
  minMinutes: number;
  targetMinutes: number;
  onFinished: () => void;
  onFailed: () => void;
}) {
  const {
    recorder: rec,
    talkback: talk,
    conversation,
    sparks,
    floor,
    poke,
    isRecording,
    isBusy,
    stopRecording,
    cues,
  } = useCapture();
  const [stopping, setStopping] = useState(false);
  const plan = planFrom(cues.drafts, task.planTitle);

  const hearing = talk.status === "speaking";
  const connected = talk.status === "listening" || talk.status === "speaking";
  const minutes = Math.floor(rec.elapsedMs / 60_000);
  const timeUp = rec.elapsedMs >= minMinutes * 60_000;
  // The plan is the task: no Finish on a conversation that decided nothing.
  const canFinish = timeUp && plan !== null;

  // Tell the server which drive is the conversation, once the recorder has
  // registered it. The registration can land after this first asks, so retry.
  const sessionId = rec.currentSessionId;
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let tries = 0;
    const send = async () => {
      if (cancelled || tries >= STARTED_TRIES) return;
      tries += 1;
      const res = await fetch("/api/prolific/part1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "started", captureSessionId: sessionId }),
      }).catch(() => null);
      if (!res?.ok && !cancelled)
        window.setTimeout(() => void send(), STARTED_RETRY_MS);
    };
    void send();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Ended once they asked for it and the last chunk is out of the recorder.
  useEffect(() => {
    if (stopping && !isRecording && rec.status === "idle") onFinished();
  }, [stopping, isRecording, rec.status, onFinished]);

  // The microphone failed before or during the conversation.
  if (rec.error && !isRecording && !stopping) {
    return (
      <StudyFrame title="The recording stopped">
        <ErrorLine>{rec.error}</ErrorLine>
        <PrimaryButton onClick={onFailed}>Start again</PrimaryButton>
      </StudyFrame>
    );
  }

  const hint = !isRecording
    ? "Opening the microphone…"
    : talk.status === "degraded"
      ? "Souffleur is not reachable right now. Keep talking; it reconnects by itself."
      : !timeUp
        ? `You can finish after ${minMinutes} minutes, once your plan holds your decisions.`
        : plan === null
          ? "Before you finish: decide on your measures and ask Souffleur to put them on the plan."
          : rec.elapsedMs >= targetMinutes * 60_000
            ? "You can finish whenever you are ready."
            : `You can finish now, or keep going to about ${targetMinutes} minutes.`;

  // One column for the conversation, on the page itself, and the task and
  // the plan beside it — the shape of a chat with Claude and its artifact.
  return (
    <main className="no-touch-fuss flex h-dvh w-full flex-col overflow-hidden lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <header className="mx-auto flex w-full max-w-2xl shrink-0 items-center justify-between gap-3">
          <p className="min-w-0 truncate font-semibold">{task.title}</p>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-fg/60" aria-live="off">
              {isRecording ? `${minutes} min` : "Starting…"}
            </span>
            <button
              type="button"
              disabled={!isRecording || !canFinish || stopping || isBusy}
              onClick={() => {
                setStopping(true);
                stopRecording();
              }}
              className="cursor-pointer rounded-xl bg-fg px-4 py-2 text-sm font-semibold text-canvas disabled:cursor-not-allowed disabled:opacity-40"
            >
              {stopping ? "Saving…" : "Finish"}
            </button>
          </div>
        </header>
        <p className="mx-auto w-full max-w-2xl shrink-0 pt-1 text-sm text-fg/55">{hint}</p>

        <StudyConversation
          store={conversation}
          live={isRecording}
          floor={isRecording && connected ? (talk.floor ?? floor) : null}
          speaking={isRecording && hearing}
          listening={isRecording && !hearing && Boolean(talk.userSpeaking)}
          className="min-h-0 flex-1"
        />

        <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-3">
          {/* Where Claude puts its suggested prompts: just above where you answer. */}
          {isRecording && rec.sparksArm && (
            <SparkChips
              store={conversation}
              ledger={sparks}
              connected={connected}
              speaking={hearing}
              onPull={poke}
            />
          )}
        </div>
      </div>

      <aside className="flex max-h-[45dvh] min-h-0 shrink-0 flex-col gap-4 border-t border-line bg-surface/60 p-4 lg:max-h-none lg:w-[min(30rem,38%)] lg:border-t-0 lg:border-l">
        {/* Always in view: the task is what they are talking about. */}
        <div className="shrink-0 text-sm">
          <p className="mb-1 text-xs font-medium tracking-wide text-fg/55 uppercase">The task</p>
          <p className="mb-2 leading-relaxed text-fg/85">{task.brief}</p>
          <ul className="space-y-0.5 text-fg/65">
            {task.prompts.map((p) => (
              <li key={p} className="flex gap-1.5">
                <span aria-hidden>·</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <PlanCard title={task.planTitle} plan={plan} />
      </aside>
    </main>
  );
}

/* ------------------------------------------------------------------------- */

type DraftCue = ReturnType<typeof useCapture>["cues"]["drafts"][number];

/**
 * The plan, from this drive's drafts: the one titled like the task's plan,
 * or failing that the latest draft — the agent is told to keep exactly one,
 * and a slightly different title must not leave the screen empty.
 */
function planFrom(drafts: readonly DraftCue[], title: string): DraftCue | null {
  const named = drafts.filter((d) =>
    d.title.trim().toLowerCase().includes(title.toLowerCase()),
  );
  return named.at(-1) ?? drafts.at(-1) ?? null;
}

/**
 * The plan they are building, beside the conversation. What the agent wrote
 * when they asked it to; the version label says a rewrite has landed, as on
 * the recording page.
 */
function PlanCard({ title, plan }: { title: string; plan: DraftCue | null }) {
  return (
    <section
      aria-label={title}
      className="ph-no-capture flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-sm"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="font-semibold">Your plan</span>
        {plan && <span className="font-mono text-xs text-fg/50">{plan.version}</span>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {plan ? (
          <DraftMarkdown text={plan.text} className="text-[0.95rem] leading-relaxed" />
        ) : (
          <p className="text-sm text-fg/55">
            Nothing yet. When you have decided something, say &ldquo;put that on the plan&rdquo; and Souffleur
            writes it here.
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------- */

type Page = "jol" | "tlx" | "sus";

/**
 * After the conversation, three pages: how much they expect to remember (a
 * judgement of learning), the raw NASA-TLX (did the sparks add workload?)
 * and the SUS with one instructed-response item among its ten. Sent once,
 * at the end, so a half-answered questionnaire never lands.
 */
function Questionnaire({
  onDone,
}: {
  onDone: (completion: { url: string | null; code: string | null }) => void;
}) {
  const [page, setPage] = useState<Page>("jol");
  const [jol, setJol] = useState<number | null>(null);
  const [tlx, setTlx] = useState<Partial<Record<TlxKey, number>>>({});
  const [sus, setSus] = useState<(number | null)[]>(() => SUS_ITEMS.map(() => null));
  const [attention, setAttention] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tlxDone = TLX_ITEMS.every((item) => tlx[item.key] !== undefined);
  const susDone = sus.every((x) => x !== null) && attention !== null;

  function next(to: Page) {
    setPage(to);
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    if (jol === null || !tlxDone || !susDone || attention === null) return;
    const questionnaire: ProlificQuestionnaire = {
      tlx: tlx as ProlificQuestionnaire["tlx"],
      sus: sus as number[],
      attention,
    };
    setBusy(true);
    setError(null);
    const res = await fetch("/api/prolific/part1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "finished", judgmentOfLearning: jol, questionnaire }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      completionUrl?: string | null;
      completionCode?: string | null;
    } | null;
    setBusy(false);
    if (!res?.ok) return setError("That did not save. Please try again.");
    onDone({
      url: body?.completionUrl ?? null,
      code: body?.completionCode ?? null,
    });
  }

  if (page === "jol") {
    return (
      <StudyFrame eyebrow="Part 1 of 2 · Questions 1 of 3" title="About the conversation">
        <Scale
          question="Tomorrow, how much of this conversation do you think you will remember?"
          low="Almost nothing"
          high="Almost everything"
          value={jol}
          onPick={setJol}
        />
        <PrimaryButton disabled={jol === null} onClick={() => next("tlx")}>
          Continue
        </PrimaryButton>
      </StudyFrame>
    );
  }

  if (page === "tlx") {
    return (
      <StudyFrame eyebrow="Part 1 of 2 · Questions 2 of 3" title="How demanding was it?">
        <p className="text-fg/80">
          Think of the whole conversation you just had. For each question, click
          the point on the scale that fits best.
        </p>
        {TLX_ITEMS.map((item) => (
          <TlxScale
            key={item.key}
            label={item.label}
            question={item.question}
            low={item.low}
            high={item.high}
            value={tlx[item.key] ?? null}
            onPick={(v) => setTlx((t) => ({ ...t, [item.key]: v }))}
          />
        ))}
        <PrimaryButton disabled={!tlxDone} onClick={() => next("sus")}>
          Continue
        </PrimaryButton>
      </StudyFrame>
    );
  }

  // The SUS, with the attention item after ATTENTION_AFTER of its items.
  const rows: { key: string; text: string; value: number | null; set: (v: number) => void }[] =
    SUS_ITEMS.map((text, i) => ({
      key: `sus-${i}`,
      text,
      value: sus[i] ?? null,
      set: (v: number) => setSus((s) => s.map((x, j) => (j === i ? v : x))),
    }));
  rows.splice(ATTENTION_AFTER, 0, {
    key: "attention",
    text: ATTENTION_ITEM,
    value: attention,
    set: setAttention,
  });

  return (
    <StudyFrame eyebrow="Part 1 of 2 · Questions 3 of 3" title="Using the system">
      <p className="text-fg/80">
        &ldquo;The system&rdquo; is the voice assistant and the screen you just
        used. How much do you agree with each statement?
      </p>
      {rows.map((row) => (
        <Agreement key={row.key} statement={row.text} value={row.value} onPick={row.set} disabled={busy} />
      ))}
      {error && <ErrorLine>{error}</ErrorLine>}
      <PrimaryButton disabled={!susDone || busy} onClick={() => void submit()}>
        Finish part 1
      </PrimaryButton>
    </StudyFrame>
  );
}

/**
 * One NASA-TLX subscale: the published 21 points, 0 to 100 in steps of 5,
 * with no point chosen until they click one.
 */
function TlxScale({
  label,
  question,
  low,
  high,
  value,
  onPick,
}: {
  label: string;
  question: string;
  low: string;
  high: string;
  value: number | null;
  onPick: (value: number) => void;
}) {
  const points = Array.from({ length: 21 }, (_, i) => i * 5);
  return (
    <fieldset>
      <legend className="mb-0.5 font-medium">{label}</legend>
      <p className="mb-2 text-sm text-fg/70">{question}</p>
      <div className="flex h-10 items-stretch" role="radiogroup" aria-label={label}>
        {points.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value === p}
            aria-label={`${p} of 100`}
            onClick={() => onPick(p)}
            className={[
              "flex-1 cursor-pointer border-y border-l border-fg/25 last:border-r first:rounded-l-lg last:rounded-r-lg",
              value === p ? "bg-fg" : "bg-transparent hover:bg-fg/10",
              p === 50 ? "border-l-fg/50" : "",
            ].join(" ")}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-fg/55">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}

const AGREEMENT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"] as const;

/** One statement, 1 (strongly disagree) to 5 (strongly agree). */
function Agreement({
  statement,
  value,
  disabled,
  onPick,
}: {
  statement: string;
  value: number | null;
  disabled?: boolean;
  onPick: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-medium">{statement}</legend>
      <div className="grid grid-cols-5 gap-1.5">
        {AGREEMENT.map((label, i) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            aria-pressed={value === i + 1}
            onClick={() => onPick(i + 1)}
            className={[
              "min-h-11 cursor-pointer rounded-xl px-1 text-xs leading-tight font-medium disabled:opacity-40 sm:text-sm",
              value === i + 1 ? "bg-fg text-canvas" : "bg-fg/10 hover:bg-fg/15",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
