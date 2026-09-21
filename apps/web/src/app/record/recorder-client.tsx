"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatOffset } from "@voicemural/shared";
// The `/profile` subpath, NOT the package index: the index re-exports
// retrieval.ts, which imports @voicemural/db, and that drags the Postgres
// driver into the browser bundle. profile.ts is pure by construction.
import { PROFILE } from "@voicemural/talkback/profile";
import { TALKBACK_ENABLED, useCapture } from "@/components/capture-provider";
import {
  ConditionToggles,
  LanguagePicker,
  VoicePicker,
} from "@/components/capture-settings";
import { RecordingBadge } from "@/components/recording-badge";
import { useCues } from "@/lib/display/use-cues";
import { DEBRIEF_MAX_MS, DEBRIEF_QUESTIONS } from "@/lib/study/debrief";
import { CuePanel } from "./cue-panel";
import { DraftPanel } from "./draft-panel";
import { PostDriveItems, PreDriveItem, recordStudyResponse } from "./study-items";
import { TopicTitle } from "./topic-title";

/**
 * The recorder screen.
 *
 * Designed to be operated at a glance from a car cradle: one enormous target
 * to START, state legible in peripheral vision, and no interaction that
 * requires reading.
 *
 * WHILE RECORDING THERE IS NO BIG BUTTON. It used to stay on screen as a
 * 224px "Stop", and with the dock's own stop control under it that was two
 * ways to end a drive stacked on top of each other, taking the whole upper
 * half of the screen to do it. Stopping is now a small control in the header
 * and the dock's armed two-tap; the space goes to what the drive is ABOUT —
 * the current subject, the trail of earlier ones, then the cue panel.
 */
export function RecorderClient() {
  // The recorder itself lives above the router now (see capture-provider.tsx),
  // so a drive survives walking over to the board and back. This screen is the
  // full view onto it, not its owner.
  const {
    recorder: rec,
    talkback: talk,
    isRecording,
    isDebriefing,
    isBusy,
    startRecording,
    stopRecording,
    finishDebrief,
  } = useCapture();

  /* The pre item's answer, held until a drive exists to attach it to.
   *
   * A rating is about a session and the session id is generated at the moment
   * of starting, so the answer cannot be posted when it is given. Answering is
   * never a precondition for recording: a participant who taps record straight
   * away simply has no pre value, which is a missing cell rather than a lost
   * drive. */
  const pendingPre = useRef<Record<string, number>>({});
  useEffect(() => {
    const sessionId = rec.currentSessionId;
    if (!sessionId) return;
    const held = pendingPre.current;
    pendingPre.current = {};
    for (const [item, value] of Object.entries(held)) {
      recordStudyResponse(sessionId, "pre", item, value);
    }
  }, [rec.currentSessionId]);
  const hearing = talk.status === "speaking";

  // Reads Postgres, never the voice container: the panel keeps filling with
  // talk-back dead, and survives a reload mid-recording. See the route comment.
  const cues = useCues({
    captureSessionId: rec.currentSessionId,
    budgets: {
      content: PROFILE.maxContentCues,
      directions: PROFILE.maxDirectionCues,
    },
    enabled: isRecording && PROFILE.displayAllowed,
  });

  return (
    // `pb-40` clears the dock: leaving mid-drive is the point of hoisting the
    // recorder, so the dock is on this screen too — with its own record button
    // suppressed, because the 224px one below is the transport here.
    <main className="no-touch-fuss flex min-h-dvh flex-col items-center justify-between p-6 pb-40">
      <header className="flex w-full max-w-md items-center justify-between gap-3 text-sm text-white/50">
        {/* PRESENT OR ABSENT, never a shade of something. Everything else that
            said "recording" was a modifier of a control that is always there —
            a colour, a meter inside the button, a timer that starts counting —
            and a first-time participant has nothing to compare it against.
            See `RecordingBadge`. */}
        {isRecording || isDebriefing ? (
          <RecordingBadge elapsedMs={rec.elapsedMs} debriefing={isDebriefing} />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          <StatusPills
            pending={rec.pendingUploads}
            uploading={rec.uploading}
            wakeLock={rec.wakeLockActive}
            recording={isRecording}
            talkback={TALKBACK_ENABLED && isRecording ? talk.status : null}
            memory={TALKBACK_ENABLED && isRecording ? talk.memory : null}
          />
          {/* One tap, no confirmation, as the big button was — but small, so
              a stray hand in a cradle is unlikely to find it. The dock's stop
              is the deliberate one: it arms first (`STOP_ARM_MS` there). */}
          {isRecording && (
            <button
              type="button"
              onClick={stopRecording}
              disabled={isBusy}
              aria-label="Stop recording"
              className={[
                "grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-white/80",
                "transition-colors hover:bg-white/20 hover:text-white disabled:opacity-50",
                hearing ? "bg-accent/40 ring-2 ring-accent/60" : "bg-white/10",
              ].join(" ")}
            >
              <X size={18} aria-hidden />
            </button>
          )}
        </div>
      </header>

      <div className="flex w-full flex-col items-center gap-8">
        {!isRecording && !isDebriefing && (
          <>
            <button
              type="button"
              onClick={startRecording}
              disabled={isBusy}
              className={[
                "relative flex size-56 cursor-pointer items-center justify-center rounded-full text-2xl font-medium",
                "bg-ink-soft text-white ring-1 ring-line transition-transform active:scale-95 disabled:opacity-50 sm:size-64",
              ].join(" ")}
            >
              {isBusy ? "…" : "Record"}
            </button>

            <p className="h-5 text-center text-sm text-white/40">
              {isBusy ? (
                // A tap that opens a microphone takes about a second, and until
                // now that second showed an ellipsis on a disabled button — which
                // reads as "it did not hear me" and invites a second tap.
                <span className="text-white/60">
                  {rec.status === "requesting" ? "Opening the microphone…" : "Saving…"}
                </span>
              ) : (
                "Tap to start. Say whatever you are working on."
              )}
            </p>
          </>
        )}

        {isDebriefing && (
          <DebriefPanel
            startedMs={rec.debriefStartedMs}
            elapsedMs={rec.elapsedMs}
            captureSessionId={rec.currentSessionId}
            busy={isBusy}
            onDone={finishDebrief}
          />
        )}

        {!isRecording && !isDebriefing && <VoicePicker />}

        {!isRecording && !isDebriefing && <LanguagePicker />}

        {/* Pilot builds only, and pilot accounts only. See `ConditionToggles`. */}
        {!isRecording && !isDebriefing && <ConditionToggles />}

        {/* Before the drive: the item is about what they are carrying now. */}
        {!isRecording && !isDebriefing && (
          <PreDriveItem
            onAnswer={(item, value) => {
              pendingPre.current[item] = value;
            }}
          />
        )}

        {TALKBACK_ENABLED && isRecording && (
          <TopicTitle
            title={talk.title}
            sessionId={rec.currentSessionId}
            placeholder={PROFILE.hint}
          />
        )}

        {isRecording && <CuePanel cues={cues} />}

        {/* Below the cue panel, because a draft is read deliberately and the
            glanceable lane must keep the position it has trained. */}
        {isRecording && <DraftPanel drafts={cues.drafts} />}
      </div>

      <footer className="w-full max-w-md space-y-3 text-sm">
        {rec.lastSessionId && !isRecording && !isDebriefing && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <p className="mb-1 font-medium text-emerald-100">
              Saved {formatOffset(rec.lastSessionMs)}
            </p>
            <p className="mb-3 text-white/60">
              {rec.pendingUploads > 0
                ? `${rec.pendingUploads} chunk${rec.pendingUploads === 1 ? "" : "s"} still uploading. The transcript fills in as they land.`
                : "Transcription runs in the background; the transcript fills in as it goes."}
            </p>
            <Link
              href={`/sessions/${rec.lastSessionId}`}
              className="inline-block rounded bg-white px-3 py-1.5 font-medium text-ink hover:bg-white/90"
            >
              View transcript
            </Link>
          </div>
        )}

        {rec.error && (
          <Notice tone="error" title="Recording stopped">
            {rec.error}
          </Notice>
        )}

        {rec.lastUploadError && rec.pendingUploads > 0 && (
          <Notice tone="warn" title="Waiting for signal">
            {rec.pendingUploads} chunk{rec.pendingUploads === 1 ? "" : "s"} held
            on this device. They upload automatically — nothing is lost.
          </Notice>
        )}

        {isRecording && !rec.wakeLockActive && (
          <Notice tone="warn" title="Screen may sleep">
            This browser would not hold a wake lock. If the screen locks,
            recording stops — set the display timeout to Never.
          </Notice>
        )}

        {rec.resumable && !isRecording && !isDebriefing && (
          <Notice tone="warn" title="Unfinished session found">
            <div className="space-y-2">
              <p>
                A session from{" "}
                {new Date(rec.resumable.startedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                was never closed. Its audio is queued and will still upload.
              </p>
              <button
                type="button"
                onClick={() => void rec.dismissResumable()}
                className="rounded bg-white/10 px-3 py-1.5 hover:bg-white/20"
              >
                Close it out
              </button>
            </div>
          </Notice>
        )}
      </footer>
    </main>
  );
}

/**
 * The three questions, asked while the microphone is still open.
 *
 * WHY THIS EXISTS AT ALL. The first formative pilot (19 Sep 2026) recorded
 * 5m44s and then stopped, and the most useful thing the participant said came
 * afterwards: that the agent mangled a place name, that she wanted it to say
 * "warte kurz, ich suche" before a lookup, and — watching it sit silent — "ist
 * jetzt die App ausgegangen?". None of it is in the ledger. It exists because
 * somebody happened to be filming.
 *
 * READ DELIBERATELY, unlike everything else on this screen. The cue panel is
 * glanceable because a driver cannot read; this appears only once the drive is
 * over and the phone is in a hand. The questions are still spoken aloud rather
 * than typed, and "nothing today" is a complete answer to all three.
 */
function DebriefPanel({
  startedMs,
  elapsedMs,
  captureSessionId,
  busy,
  onDone,
}: {
  startedMs: number | null;
  elapsedMs: number;
  captureSessionId: string | null;
  busy: boolean;
  onDone: () => void;
}) {
  // From the chunk clock, not a wall clock: it is the same clock the stored
  // offsets are on, and it advances a chunk at a time, which is exactly the
  // granularity worth showing.
  const usedMs = startedMs === null ? 0 : Math.max(0, elapsedMs - startedMs);
  const leftSecs = Math.max(0, Math.ceil((DEBRIEF_MAX_MS - usedMs) / 1000));

  return (
    <section className="w-full max-w-md rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-amber-100">Before you go</h2>
        <span className="font-mono text-xs tabular-nums text-amber-200/60">
          {leftSecs}s
        </span>
      </header>
      <ol className="space-y-2.5 text-sm leading-relaxed text-white/80">
        {DEBRIEF_QUESTIONS.map((question, i) => (
          <li key={question} className="flex gap-3">
            <span className="shrink-0 font-mono text-xs text-white/30">{i + 1}</span>
            {question}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-white/40">
        Say them out loud. These answers are the part of a drive the research
        team reads — nothing else is. &ldquo;Nothing today&rdquo; is a fine
        answer.
      </p>
      {/* Under the spoken questions, not over them: those are what the window
          is for, and a row of number buttons above them would make the drive
          end with a form. */}
      <PostDriveItems captureSessionId={captureSessionId} />
      {/* Ends the debrief, and with it the recording. Amber like the panel,
          not the drive's own colour: the channel changed and they were told
          it would. Full width, because the phone is in a hand by now and a
          thumb wants the bottom of the card. */}
      <button
        type="button"
        onClick={onDone}
        disabled={busy}
        className="mt-4 w-full cursor-pointer rounded-lg bg-amber-500/90 px-4 py-3 text-base font-medium text-white transition-transform active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? "Saving…" : "Done"}
      </button>
    </section>
  );
}

function StatusPills({
  pending,
  uploading,
  wakeLock,
  recording,
  talkback,
  memory,
}: {
  pending: number;
  uploading: boolean;
  wakeLock: boolean;
  recording: boolean;
  talkback: string | null;
  memory: "ready" | "unavailable" | null;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {recording && wakeLock && <Pill label="awake" tone="ok" />}
      {/* Only worth showing when it is NOT working. A healthy socket needs no
          pill: the topic title naming what is being talked about is the
          evidence, and a car dashboard should not carry an indicator for every
          subsystem that is fine. */}
      {talkback === "degraded" && <Pill label="talk offline" tone="warn" />}
      {talkback === "connecting" && <Pill label="talk…" tone="warn" />}
      {/* Connected but amnesiac. Distinct from "talk offline" because the
          conversation still works — it just cannot reach anything said before,
          which is the difference between a thin answer and a broken one. */}
      {memory === "unavailable" && <Pill label="no memory" tone="warn" />}
      {pending > 0 && (
        <Pill
          label={uploading ? `↑ ${pending}` : `${pending} queued`}
          tone="warn"
        />
      )}
      {pending === 0 && !recording && <Pill label="synced" tone="ok" />}
    </div>
  );
}

function Pill({ label, tone }: { label: string; tone: "ok" | "warn" }) {
  return (
    <span
      className={[
        "rounded-full px-2 py-0.5 font-mono",
        tone === "ok"
          ? "bg-emerald-500/15 text-emerald-300"
          : "bg-amber-500/15 text-amber-300",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "error" | "warn";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={[
        "rounded-lg border p-3",
        tone === "error"
          ? "border-red-500/30 bg-red-500/10 text-red-200"
          : "border-amber-500/30 bg-amber-500/10 text-amber-100",
      ].join(" ")}
    >
      <p className="mb-1 font-medium">{title}</p>
      <div className="text-white/70">{children}</div>
    </div>
  );
}
