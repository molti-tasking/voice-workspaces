"use client";

import Link from "next/link";
import { formatOffset } from "@voicemural/shared";
import { useRecorder } from "@/lib/recorder/use-recorder";

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
              ? "bg-[var(--color-accent)] text-white shadow-[0_0_0_12px_var(--color-accent-soft)]"
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
      </div>

      <footer className="w-full max-w-md space-y-3 text-sm">
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

function StatusPills({
  pending,
  uploading,
  wakeLock,
  recording,
}: {
  pending: number;
  uploading: boolean;
  wakeLock: boolean;
  recording: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {recording && wakeLock && <Pill label="awake" tone="ok" />}
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
