"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatOffset } from "@voicemural/shared";
// The `/setting` subpath, NOT the package index: the index re-exports
// retrieval.ts, which imports @voicemural/db, and that drags the Postgres
// driver into the browser bundle. setting.ts is pure by construction.
import { SETTING_PROFILES } from "@voicemural/talkback/setting";
import { TALKBACK_ENABLED, useCapture } from "@/components/capture-provider";
import {
  ConditionToggles,
  LanguagePicker,
  SettingPicker,
  VoicePicker,
} from "@/components/capture-settings";
import { MicLevel } from "@/components/mic-level";
import { useCues } from "@/lib/display/use-cues";
import { CuePanel } from "./cue-panel";
import { DraftPanel } from "./draft-panel";
import { DebriefPanel, PreDriveItem, recordStudyResponse } from "./study-items";
import { TopicTitle } from "./topic-title";

/**
 * The recorder screen.
 *
 * Designed to be operated at a glance from a car cradle: one enormous target,
 * state legible in peripheral vision, and no interaction that requires reading.
 */
export function RecorderClient() {
  // The recorder itself lives above the router now (see capture-provider.tsx),
  // so a drive survives walking over to the board and back. This screen is the
  // full view onto it, not its owner.
  const {
    recorder: rec,
    talkback: talk,
    isRecording,
    isBusy,
    setting,
    source,
    settingUnknown,
    startRecording,
    stopRecording,
    finishDrive,
    debriefing,
  } = useCapture();

  // Open by default when nothing has told us where they are. The fallback is
  // `driving` — 25-word replies, no screen — and Pilot 01 ran a stationary
  // first-time user under exactly that because the question was never put.
  const [showPicker, setShowPicker] = useState(false);
  const pickerOpen = showPicker || settingUnknown;

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
  const profile = SETTING_PROFILES[setting];
  const hearing = talk.status === "speaking";

  // Reads Postgres, never the voice container: the panel keeps filling with
  // talk-back dead, and survives a reload mid-recording. See the route comment.
  const cues = useCues({
    captureSessionId: rec.currentSessionId,
    budgets: {
      content: profile.maxContentCues,
      directions: profile.maxDirectionCues,
    },
    enabled: isRecording && profile.displayAllowed,
  });

  return (
    // `pb-40` clears the dock: leaving mid-drive is the point of hoisting the
    // recorder, so the dock is on this screen too — with its own record button
    // suppressed, because the 224px one below is the transport here.
    <main className="no-touch-fuss flex min-h-dvh flex-col items-center justify-between p-6 pb-40">
      <header className="flex w-full max-w-md items-center justify-end text-sm text-white/50">
        <StatusPills
          pending={rec.pendingUploads}
          uploading={rec.uploading}
          wakeLock={rec.wakeLockActive}
          recording={isRecording}
          talkback={TALKBACK_ENABLED && isRecording ? talk.status : null}
          memory={TALKBACK_ENABLED && isRecording ? talk.memory : null}
        />
      </header>

      <div className="flex flex-col items-center gap-8">
        <div
          className="font-mono text-6xl tabular-nums sm:text-7xl"
          aria-live="off"
          aria-label="Elapsed recording time"
        >
          {formatOffset(rec.elapsedMs)}
        </div>

        <button
          type="button"
          onClick={() => {
            if (isRecording) {
              // One tap, no confirmation: this target is 224px and is meant to
              // be hit without looking. The dock's 64px button arms first —
              // see `STOP_ARM_MS` there.
              //
              // It no longer ends the drive: it stops talk-back and opens the
              // debrief below, with the microphone still running. The done
              // button in that panel is what closes the session.
              stopRecording();
              return;
            }
            // Nothing has said where they are, so ask rather than start under
            // a guess. See `settingUnknown`.
            if (settingUnknown) {
              setShowPicker(true);
              return;
            }
            startRecording();
          }}
          disabled={isBusy || debriefing}
          className={[
            "relative cursor-pointer flex size-56 items-center justify-center rounded-full text-2xl font-medium",
            "transition-transform active:scale-95 disabled:opacity-50 sm:size-64",
            isRecording
              ? hearing
                ? "bg-accent text-white shadow-[0_0_0_18px_var(--color-accent-soft)]"
                : "bg-accent text-white shadow-[0_0_0_12px_var(--color-accent-soft)]"
              : "bg-ink-soft text-white ring-1 ring-line",
          ].join(" ")}
        >
          {isRecording && <MicLevel />}
          <span className="relative">
            {isBusy ? "…" : debriefing ? "Debrief" : isRecording ? "Stop" : "Record"}
          </span>
        </button>

        <p className="h-5 text-center text-sm text-white/40">
          {debriefing ? (
            "Still recording — answer the three questions below."
          ) : isRecording ? (
            profile.hint
          ) : settingUnknown ? (
            <span className="text-amber-200/80">Where are you? Pick one to start.</span>
          ) : (
            <>
              {source === "chosen" || source === "remembered" ? "" : "Looks like: "}
              <span className="text-white/70">{profile.label}</span>
              {" · "}
              <button
                type="button"
                onClick={() => setShowPicker((v) => !v)}
                className="cursor-pointer underline-offset-4 hover:underline"
              >
                {showPicker ? "done" : "not right?"}
              </button>
            </>
          )}
        </p>

        {!isRecording && pickerOpen && <SettingPicker />}

        {!isRecording && <VoicePicker />}

        {!isRecording && <LanguagePicker />}

        {/* Pilot builds only, and pilot accounts only. See `ConditionToggles`. */}
        {!isRecording && <ConditionToggles />}

        {/* Before the drive, and only when one can start: the item is about
            what they are carrying now, and asking it under a settings sheet
            they are still working through would be asking it too early. */}
        {!isRecording && !settingUnknown && (
          <PreDriveItem
            onAnswer={(item, value) => {
              pendingPre.current[item] = value;
            }}
          />
        )}

        {TALKBACK_ENABLED && isRecording && !debriefing && <TopicTitle title={talk.title} />}

        {debriefing && (
          <DebriefPanel captureSessionId={rec.currentSessionId} onDone={finishDrive} />
        )}

        {isRecording && !debriefing && <CuePanel cues={cues} />}

        {/* Below the cue panel, because a draft is read deliberately and the
            glanceable lane must keep the position it has trained. */}
        {isRecording && !debriefing && <DraftPanel drafts={cues.drafts} />}
      </div>

      <footer className="w-full max-w-md space-y-3 text-sm">
        {rec.lastSessionId && !isRecording && (
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
              className="inline-block rounded bg-white px-3 py-1.5 font-medium text-[var(--color-ink)] hover:bg-white/90"
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

        {rec.resumable && !isRecording && (
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
