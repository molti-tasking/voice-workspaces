"use client";

import Link from "next/link";
import { formatOffset } from "@voicemural/shared";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { configuredBackend, useTalkback } from "@/lib/talkback/use-talkback";

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

  // Armed with the recording, for the whole drive — there is no separate
  // gesture to enter it. Everything it does is downstream of the microphone
  // stream the recorder publishes, so capture is unaffected either way.
  const talk = useTalkback({
    captureSessionId: rec.currentSessionId,
    enabled: TALKBACK && isRecording,
  });
  const hearing = talk.status === "speaking";

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
          backend={TALKBACK && isRecording ? configuredBackend() : null}
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
          onClick={() => (isRecording ? void rec.stop() : void rec.start())}
          disabled={isBusy}
          className={[
            "flex size-56 items-center justify-center rounded-full text-2xl font-medium",
            "transition-transform active:scale-95 disabled:opacity-50 sm:size-64",
            isRecording
              ? hearing
                ? "bg-[var(--color-accent)] text-white shadow-[0_0_0_18px_var(--color-accent-soft)]"
                : "bg-[var(--color-accent)] text-white shadow-[0_0_0_12px_var(--color-accent-soft)]"
              : "bg-[var(--color-ink-soft)] text-white ring-1 ring-[var(--color-line)]",
          ].join(" ")}
        >
          {isBusy ? "…" : isRecording ? "Stop" : "Record"}
        </button>

        <p className="h-5 text-center text-sm text-white/40">
          {isRecording
            ? "Keep this screen on and the app in front."
            : "Mount the phone, plug it in, then start."}
        </p>

        {TALKBACK && isRecording && talk.reply && (
          <div className="max-w-md">
            <AgentReply text={talk.reply} replying={talk.status === "speaking"} />
          </div>
        )}
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
            {rec.pendingUploads} chunk{rec.pendingUploads === 1 ? "" : "s"} held on this
            device. They upload automatically — nothing is lost.
          </Notice>
        )}

        {isRecording && !rec.wakeLockActive && (
          <Notice tone="warn" title="Screen may sleep">
            This browser would not hold a wake lock. If the screen locks, recording
            stops — set the display timeout to Never.
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
 * What the system is saying.
 *
 * Brighter than the transcript and above it, because this is the half of the
 * dialogue the driver did not produce. Until TTS is wired up this is the only
 * channel the reply has; once it speaks, this becomes redundancy for a glance
 * rather than the primary output.
 */
function AgentReply({ text, replying }: { text: string; replying: boolean }) {
  return (
    <p
      className={[
        "text-balance text-center text-lg",
        replying ? "text-white/70" : "text-white",
      ].join(" ")}
      // Never announced: a screen reader interrupting a driver mid-thought is
      // exactly the failure this whole design is trying to avoid.
      aria-live="off"
    >
      {text}
      {replying && <span className="ml-1 animate-pulse text-white/40">▍</span>}
    </p>
  );
}

function StatusPills({
  pending,
  uploading,
  wakeLock,
  recording,
  talkback,
  backend,
}: {
  pending: number;
  uploading: boolean;
  wakeLock: boolean;
  recording: boolean;
  talkback: string | null;
  backend: string | null;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {recording && wakeLock && <Pill label="awake" tone="ok" />}
      {/* Which implementation is speaking. Shown only while both exist: judging
          one and attributing the verdict to the other would waste the whole
          comparison. Remove this with the losing backend. */}
      {backend && <Pill label={backend} tone="ok" />}
      {/* Only worth showing when it is NOT working. A healthy socket needs no
          pill: the transcript appearing is the evidence, and a car dashboard
          should not carry an indicator for every subsystem that is fine. */}
      {talkback === "degraded" && <Pill label="talk offline" tone="warn" />}
      {talkback === "connecting" && <Pill label="talk…" tone="warn" />}
      {pending > 0 && (
        <Pill label={uploading ? `↑ ${pending}` : `${pending} queued`} tone="warn" />
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
        tone === "ok" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300",
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
