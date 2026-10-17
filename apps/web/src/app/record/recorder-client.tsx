"use client";

import { Square } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
import { ConversationPanels } from "./conversation-panels";
import { FloorControls } from "./floor-controls";
import { PostDriveItems } from "./study-items";

/**
 * The recorder screen.
 *
 * Before a drive: one enormous target to START, and the voice and language to
 * start with.
 *
 * DURING ONE, TURN-TAKING AND NOTHING ELSE. The study has moved to who holds
 * the floor, so the screen is the conversation — the agent's turns in one
 * panel, the person's in the other, filed by subject — and exactly three
 * things to do about it: Lock (only they speak), Normal (the agent may talk
 * back) and Poke (one turn from the agent, now). Plus Stop, which has to be
 * here. The cue panel, the drafts and the transcript link are gone from this
 * screen, and the dock with them while a drive runs: every one of them was a
 * reason to look away from the turns. Drafts are still written and kept; they
 * are on `/sessions/[id]`.
 *
 * THE WHOLE SCREEN, NOT A PAGE. While recording the layout is the height of
 * the viewport, with the panels scrolling inside it, so the controls never
 * scroll away from a thumb and the header never scrolls away from a glance.
 *
 * THE CONVERSATION OUTLIVES THE DRIVE. Stop used to take everything off the
 * screen at once, at the moment there was time to read it. Once a drive has
 * started, this screen is that conversation until the next one replaces it:
 * live, then ended, with three ratings over it until they tap Done.
 * The next drive starts from the dock's record button, which comes back on
 * this screen once nothing is running (6 Oct 2026).
 */
export function RecorderClient() {
  // The recorder itself lives above the router (see capture-provider.tsx), so a
  // drive survives walking over to the board and back. This screen is the full
  // view onto it, not its owner.
  const {
    recorder: rec,
    talkback: talk,
    conversationId,
    conversation,
    floor,
    setFloor,
    poke,
    isRecording,
    isBusy,
    startRecording,
    stopRecording,
  } = useCapture();
  const hearing = talk.status === "speaking";
  const connected = talk.status === "listening" || talk.status === "speaking";

  // Setup until the first drive of this page load; the conversation from then
  // on. `ended` is that conversation once nothing is capturing any more.
  const hasConversation = conversationId !== null;
  const ended = hasConversation && !isRecording;

  // The ratings, once per drive: shown over the finished conversation until
  // Done, and not again for the same drive.
  const [ratedFor, setRatedFor] = useState<string | null>(null);
  const askRatings = ended && rec.lastSessionId !== null && ratedFor !== rec.lastSessionId;

  const topBar = (
    // Clear of the status bar: in a standalone PWA the stop sat under the clock.
    <div className="vm-safe-top flex w-full shrink-0 justify-center pb-2">
      <header className="flex w-full items-center justify-between gap-2 text-sm text-fg/65">
        {/* PRESENT OR ABSENT, never a shade of something. See `RecordingBadge`. */}
        {isRecording ? (
          <RecordingBadge elapsedMs={rec.elapsedMs} />
        ) : ended ? (
          // Words, not a muted badge: the badge is present or absent, and its
          // absence alone does not say the conversation below is over.
          <span className="text-fg/60">
            {rec.status === "requesting"
              ? "Opening the microphone…"
              : rec.status === "stopping"
                ? "Saving…"
                : "Ended"}
          </span>
        ) : (
          <span />
        )}
        {/* THE STOP MUST FIT. On a 390px phone this row once pushed the stop
            off the right edge (7 Oct 2026), and during a drive it is the only
            stop there is. So the pills may shrink and wrap, and only the badge
            and the stop refuse to. */}
        <div className="flex min-w-0 items-center justify-end gap-2">
          <StatusPills
            pending={rec.pendingUploads}
            uploading={rec.uploading}
            recording={isRecording}
            talkback={TALKBACK_ENABLED && isRecording ? talk.status : null}
            memory={TALKBACK_ENABLED && isRecording ? talk.memory : null}
          />
          {/* One tap, no confirmation, as the big button was — but small, so a
              stray hand in a cradle is unlikely to find it. The ring says the
              agent is talking, wherever the eye is. */}
          {isRecording && (
            <button
              type="button"
              onClick={stopRecording}
              disabled={isBusy}
              aria-label="Stop recording"
              className={[
                "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-fg/80",
                "transition-colors hover:bg-fg/20 hover:text-fg disabled:opacity-50",
                hearing ? "bg-accent/40 ring-2 ring-accent/60" : "bg-fg/10",
              ].join(" ")}
            >
              <Square size={16} fill="currentColor" aria-hidden />
            </button>
          )}
        </div>
      </header>
    </div>
  );

  if (!hasConversation) {
    return (
      // `pb-40` clears the dock, which is on this screen before a drive.
      <main className="no-touch-fuss flex min-h-dvh flex-col items-center justify-between px-6 pb-40">
        <div className="w-full max-w-md">{topBar}</div>

        <div className="flex w-full flex-col items-center gap-8">
          <button
            type="button"
            onClick={startRecording}
            disabled={isBusy}
            className={[
              "relative flex size-56 cursor-pointer items-center justify-center rounded-full text-2xl font-medium",
              "bg-surface text-fg ring-1 ring-line transition-transform active:scale-95 disabled:opacity-50 sm:size-64",
            ].join(" ")}
          >
            {isBusy ? "…" : "Record"}
          </button>

          <p className="h-5 text-center text-sm text-fg/60">
            {isBusy ? (
              // A tap that opens a microphone takes about a second, and until
              // now that second showed an ellipsis on a disabled button — which
              // reads as "it did not hear me" and invites a second tap.
              <span className="text-fg/60">
                {rec.status === "requesting" ? "Opening the microphone…" : "Saving…"}
              </span>
            ) : (
              "Tap to start. Say whatever you are working on."
            )}
          </p>

          <VoicePicker />
          <LanguagePicker />
          {/* Pilot builds only, and pilot accounts only. See `ConditionToggles`. */}
          <ConditionToggles />
        </div>

        <footer className="w-full max-w-md space-y-3 text-sm">
          <Notices />
        </footer>
      </main>
    );
  }

  return (
    <main
      className={[
        "no-touch-fuss mx-auto flex w-full max-w-5xl flex-col gap-3 px-4",
        // While recording: exactly the screen, panels scrolling inside it, and
        // no dock (app-dock-client.tsx) — the controls sit where it was. After
        // it, an ordinary page above the dock again.
        isRecording
          ? "h-dvh overflow-hidden pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          : "min-h-dvh pb-40",
      ].join(" ")}
    >
      {topBar}

      {askRatings && (
        <Ratings
          captureSessionId={rec.lastSessionId}
          onDone={() => setRatedFor(rec.lastSessionId)}
        />
      )}

      <ConversationPanels
        // Keyed by the drive: the next one starts from nothing, scrolled to
        // its top, rather than inheriting the last one's scroll position.
        key={conversationId}
        store={conversation}
        live={isRecording}
        floor={TALKBACK_ENABLED && isRecording ? (talk.floor ?? floor) : null}
        // The agent first: its own voice can reach the microphone, and their
        // panel must not light up because the agent is talking.
        speaker={!isRecording ? null : hearing ? "agent" : talk.userSpeaking ? "user" : null}
        // "It is listening" is true only while it is.
        placeholder={isRecording ? PROFILE.hint : undefined}
        className={isRecording ? "min-h-0 flex-1" : "h-[65dvh] shrink-0"}
      />

      <div className="shrink-0 space-y-3 text-sm">
        <Notices />
        {ended && rec.lastSessionId && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <p className="mb-1 font-medium text-emerald-100">
              Saved {formatOffset(rec.lastSessionMs)}
            </p>
            <p className="mb-3 text-fg/60">
              {rec.pendingUploads > 0
                ? `${rec.pendingUploads} chunk${rec.pendingUploads === 1 ? "" : "s"} still uploading. The transcript fills in as they land.`
                : "Transcription runs in the background; the transcript fills in as it goes."}
            </p>
            <Link
              href={`/sessions/${rec.lastSessionId}`}
              className="inline-block rounded bg-fg px-3 py-1.5 font-medium text-canvas hover:bg-fg/90"
            >
              View transcript
            </Link>
          </div>
        )}
      </div>

      {TALKBACK_ENABLED && isRecording && (
        <FloorControls
          floor={floor}
          applied={talk.floor}
          connected={connected}
          speaking={hearing}
          onFloor={setFloor}
          onPoke={poke}
        />
      )}
    </main>
  );
}

/**
 * What can go wrong with capture itself, said where it is seen. The same on
 * every phase of the screen, because none of it waits for a phase.
 */
function Notices() {
  const { recorder: rec, isRecording } = useCapture();
  return (
    <>
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
              className="rounded bg-fg/10 px-3 py-1.5 hover:bg-fg/20"
            >
              Close it out
            </button>
          </div>
        </Notice>
      )}
    </>
  );
}

/**
 * Three ratings after a drive, with the microphone already closed.
 *
 * THEY USED TO BE A DEBRIEF. Stop kept recording for a window in which the
 * participant answered questions out loud — three, then one — with scales
 * under them. It ran past the bottom of a phone, and on 14 Oct 2026 the person
 * answered the scales aloud ("Give it a 4") into a recording that was waiting
 * for something else. Taps need no microphone, so Stop now ends the recording
 * and this asks over the finished conversation.
 *
 * Skippable by design: each tap is saved as it is made, Done only closes the
 * card, and a drive left unrated is a missing cell, not a broken one.
 */
function Ratings({
  captureSessionId,
  onDone,
}: {
  captureSessionId: string | null;
  onDone: () => void;
}) {
  return (
    <section className="mx-auto w-full max-w-2xl shrink-0 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-fg">How did that go?</h2>
        <p className="mt-0.5 text-sm text-fg/60">
          The recording has stopped. One tap each, or skip any.
        </p>
      </header>
      <PostDriveItems captureSessionId={captureSessionId} />
      <button
        type="button"
        onClick={onDone}
        className="mt-5 w-full cursor-pointer rounded-2xl bg-fg px-4 py-3 text-base font-semibold text-canvas transition-transform active:scale-[0.98]"
      >
        Done
      </button>
    </section>
  );
}

function StatusPills({
  pending,
  uploading,
  recording,
  talkback,
  memory,
}: {
  pending: number;
  uploading: boolean;
  recording: boolean;
  talkback: string | null;
  memory: "ready" | "unavailable" | null;
}) {
  return (
    // Shrinks and wraps, so a warning never pushes the stop off the screen.
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 text-xs">
      {/* Only worth showing when it is NOT working. A healthy socket needs no
          pill: the panels filling with what is said is the evidence, and a car
          dashboard should not carry an indicator for every subsystem that is
          fine. */}
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
    // Shrinks to an ellipsis rather than overflowing: wrapping only helps
    // when there are several pills, and one pill wider than the space left
    // beside the stop spilled over what sat next to it (390px, "talk…").
    <span
      title={label}
      className={[
        "min-w-0 max-w-full truncate whitespace-nowrap rounded-full px-2 py-0.5 font-mono",
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
      <div className="text-fg/70">{children}</div>
    </div>
  );
}
