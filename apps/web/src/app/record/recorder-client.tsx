"use client";

import Link from "next/link";
import { useState } from "react";
import { formatOffset, type CaptureSetting } from "@voicemural/shared";
// The `/setting` subpath, NOT the package index: the index re-exports
// retrieval.ts, which imports @voicemural/db, and that drags the Postgres
// driver into the browser bundle. setting.ts is pure by construction.
import { SETTINGS, SETTING_PROFILES } from "@voicemural/talkback/setting";
import { VOICES } from "@voicemural/talkback/voice";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { useDetectedSetting } from "@/lib/recorder/detect-setting";
import { useVoice } from "@/lib/recorder/voice-store";
import { useTalkback } from "@/lib/talkback/use-talkback";
import type { TalkbackTurn } from "@/lib/talkback/types";
import { useCues } from "@/lib/display/use-cues";
import { CuePanel } from "./cue-panel";
import { DraftPanel } from "./draft-panel";

/**
 * Whether talk-back is built into this bundle.
 *
 * A build-time flag, like the PostHog token, because it decides whether the
 * conversational path exists at all for a participant. Unset means the recorder
 * behaves exactly as it did before: no socket, no worklet, nothing to go wrong.
 */
const TALKBACK = process.env.NEXT_PUBLIC_TALKBACK_ENABLED === "true";

/**
 * The recorder screen.
 *
 * Designed to be operated at a glance from a car cradle: one enormous target,
 * state legible in peripheral vision, and no interaction that requires reading.
 */
export function RecorderClient() {
  const rec = useRecorder();
  const isRecording = rec.status === "recording";
  const isBusy = rec.status === "requesting" || rec.status === "stopping";

  // Inferred from the device and its motion, not asked. See detect-setting.ts.
  // A correction holds for this visit only: the next recording is detected
  // afresh, because the situation is what changed, not the person's mind.
  const detected = useDetectedSetting({ enabled: !isRecording });
  const [chosen, choose] = useState<CaptureSetting | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const setting = chosen ?? detected.setting;
  const source = chosen ? "chosen" : detected.source;
  const profile = SETTING_PROFILES[setting];
  // Which voice answers. Only meaningful with talk-back built in, so the picker
  // is hidden otherwise — but the choice is still sent, so a session recorded
  // before talk-back was enabled for it carries the voice it would have had.
  const [voiceId, chooseVoice] = useVoice();

  // Armed with the recording, for the whole drive — there is no separate
  // gesture to enter it. Everything it does is downstream of the microphone
  // stream the recorder publishes, so capture is unaffected either way.
  const talk = useTalkback({
    captureSessionId: rec.currentSessionId,
    enabled: TALKBACK && isRecording,
  });
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
    <main className="no-touch-fuss flex min-h-dvh flex-col items-center justify-between p-6">
      <header className="flex w-full max-w-md items-center justify-between text-sm text-white/50">
        <Link href="/" className="underline-offset-4 hover:underline">
          Workspace
        </Link>
        <StatusPills
          pending={rec.pendingUploads}
          uploading={rec.uploading}
          wakeLock={rec.wakeLockActive}
          recording={isRecording}
          talkback={TALKBACK && isRecording ? talk.status : null}
          memory={TALKBACK && isRecording ? talk.memory : null}
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
              void rec.stop();
              return;
            }
            // iOS gates the accelerometer behind a tap; this is the tap. The
            // answer arrives for the next recording, and this one starts now.
            void detected.requestMotion();
            void rec.start(setting, source, voiceId);
          }}
          disabled={isBusy}
          className={[
            "cursor-pointer flex size-56 items-center justify-center rounded-full text-2xl font-medium",
            "transition-transform active:scale-95 disabled:opacity-50 sm:size-64",
            isRecording
              ? hearing
                ? "bg-accent text-white shadow-[0_0_0_18px_var(--color-accent-soft)]"
                : "bg-accent text-white shadow-[0_0_0_12px_var(--color-accent-soft)]"
              : "bg-ink-soft text-white ring-1 ring-line",
          ].join(" ")}
        >
          {isBusy ? "…" : isRecording ? "Stop" : "Record"}
        </button>

        <p className="h-5 text-center text-sm text-white/40">
          {isRecording ? (
            profile.hint
          ) : (
            <>
              {chosen ? "" : "Looks like: "}
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

        {!isRecording && showPicker && (
          <SettingPicker
            value={setting}
            onChange={(next) => {
              choose(next);
              setShowPicker(false);
            }}
            disabled={isBusy}
          />
        )}

        {TALKBACK && !isRecording && (
          <VoicePicker value={voiceId} onChange={chooseVoice} disabled={isBusy} />
        )}

        {TALKBACK && isRecording && talk.turns.length > 0 && (
          <Exchange turns={talk.turns} speaking={talk.status === "speaking"} />
        )}

        {isRecording && <CuePanel cues={cues} />}

        {/* Below the cue panel, because a draft is read deliberately and the
            glanceable lane must keep the position it has trained. */}
        {isRecording && <DraftPanel drafts={cues.drafts} />}
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

/**
 * The correction, for when the detector is wrong.
 *
 * Hidden by default: the setting is read off the device and its motion, and
 * asking anyway would make choosing a mode the first task of every recording
 * — a task, for someone whose hands are on something else. Pre-recording
 * only, deliberately so: the setting governs turn-taking and how much goes on
 * screen for the whole session, and a mid-recording change would leave a
 * session that ran under two sets of rules and is interpretable under neither.
 *
 * Four options, one row, no icons: the labels are shorter to read than any
 * pictogram is to decode.
 */
function SettingPicker({
  value,
  onChange,
  disabled,
}: {
  value: CaptureSetting;
  onChange: (next: CaptureSetting) => void;
  disabled: boolean;
}) {
  return (
    <fieldset
      className="flex w-full max-w-md flex-wrap justify-center gap-1.5"
      disabled={disabled}
    >
      <legend className="sr-only">Where are you?</legend>
      {SETTINGS.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={[
              "rounded-full px-3.5 py-1.5 text-sm transition-colors disabled:opacity-50",
              active
                ? "bg-white/12 text-white ring-1 ring-white/25"
                : "text-white/40 hover:text-white/70",
            ].join(" ")}
          >
            {SETTING_PROFILES[option].label}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * Which voice talks back, asked alongside the setting.
 *
 * Pre-recording only, for the same reason as the setting: a drive heard in two
 * voices is two conditions in one session. Smaller and dimmer than the setting
 * row because it is the less consequential choice — it changes how the system
 * sounds, not how it behaves — and the last thing between opening the app and
 * starting to think should stay one row of four words.
 */
function VoicePicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset
      className="flex w-full max-w-md flex-wrap items-center justify-center gap-1.5 text-xs"
      disabled={disabled}
    >
      <legend className="sr-only">Which voice?</legend>
      <span className="mr-1 text-white/30">Voice</span>
      {VOICES.map((voice) => {
        const active = voice.id === value;
        return (
          <button
            key={voice.id}
            type="button"
            aria-pressed={active}
            title={voice.hint}
            onClick={() => onChange(voice.id)}
            className={[
              "rounded-full px-3 py-1 transition-colors disabled:opacity-50",
              active
                ? "bg-white/12 text-white ring-1 ring-white/25"
                : "text-white/40 hover:text-white/70",
            ].join(" ")}
          >
            {voice.label}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * The conversation as it happens.
 *
 * BOTH halves, because only one of them was ever visible and that made the
 * common failure undiagnosable: when a reply seems wrong, the first thing you
 * need to know is whether the question was heard correctly. A single line of
 * agent text cannot answer that, and by the time the session transcript is
 * available the drive is over.
 *
 * The hook caps this at MAX_VISIBLE_TURNS and drops turns the silence gate
 * declined, so what is on screen is what was actually said aloud.
 *
 * Sided like `/sessions/[id]` — agent tinted and boxed, driver plain — so the
 * live view and the recorded one read the same way.
 */
function Exchange({
  turns,
  speaking,
}: {
  turns: TalkbackTurn[];
  speaking: boolean;
}) {
  const last = turns[turns.length - 1];

  return (
    <ol
      className="flex w-full max-w-md flex-col gap-1.5 text-sm"
      // Never announced. A screen reader reading this out would interrupt the
      // driver mid-thought, which is the failure the whole design avoids.
      aria-live="off"
    >
      {turns.map((turn, index) => {
        // Older turns recede rather than disappear: the newest is what matters
        // at a glance, the rest is there if you look.
        const faded = index < turns.length - 2;
        return (
          <li
            key={turn.id}
            className={
              turn.role === "agent" ? "flex justify-start" : "flex justify-end"
            }
          >
            <span
              className={[
                "max-w-[85%] rounded-lg px-3 py-1.5",
                // `transition-opacity` only — no layout animation. This renders
                // on a warm phone that is also holding a MediaRecorder open.
                "transition-opacity motion-reduce:transition-none",
                turn.role === "agent"
                  ? "rounded-tl-sm border border-sky-400/25 bg-sky-400/10 text-sky-50"
                  : "rounded-tr-sm bg-white/6 text-white/90",
                faded ? "opacity-40" : "opacity-100",
              ].join(" ")}
            >
              {turn.speaker != null && (
                // Only present once the container has heard more than one
                // voice. A single driver never sees this.
                <span className="mr-1.5 font-mono text-[0.7em] uppercase tracking-wide text-white/40">
                  S{turn.speaker}
                </span>
              )}
              {turn.text}
              {speaking && turn === last && turn.role === "agent" && (
                <span className="ml-1 animate-pulse text-white/40 motion-reduce:animate-none">
                  ▍
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
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
          pill: the transcript appearing is the evidence, and a car dashboard
          should not carry an indicator for every subsystem that is fine. */}
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
