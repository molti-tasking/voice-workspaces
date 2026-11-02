"use client";

import {
  ChevronUp,
  Mic,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatOffset } from "@voicemural/shared";
import { TALKBACK_ENABLED, useCapture } from "./capture-provider";
import { LanguagePicker, LockedSummary, VoicePicker } from "./capture-settings";
import { MicLevel } from "./mic-level";
import { Link, useDirectedPush } from "./nav-link";

/**
 * How long an armed stop stays armed, in ms.
 *
 * The dock's record button is 72px in the corner of a page someone is reading,
 * not a target on the conversation screen that is meant to be found without
 * looking — so here, and only here, stopping takes two taps. A drive cut short by a
 * mis-tap is not a cosmetic bug: the ledger is the study's measurement record,
 * and the minutes after the mis-tap do not exist anywhere else. The second tap
 * is the deliberate one; if it does not come, the recording carries on.
 */
const STOP_ARM_MS = 4_000;

/**
 * The dock: the record button, on every signed-in page but the conversation.
 *
 * IT WAS A TAB BAR (Workspace, Board or Conversations, and the record button
 * between them). Since 2 Nov 2026 the app is one screen, the conversation on
 * `/record`, and the pages that were tabs are behind the menu at its top
 * right (`MoreMenu`), so the dock is only what starts and stops a drive:
 * capture outlives a client navigation (`capture-provider.tsx`), so a page
 * reached from that menu can still start one, and starting one goes to the
 * conversation. `/record` itself has no dock: its Record and Stop are in its
 * own bar, in the same place whether a drive runs or not.
 */
export function AppDockClient() {
  const push = useDirectedPush();
  const {
    isRecording,
    isBusy,
    recorder,
    startRecording,
    stopRecording,
  } = useCapture();

  const capturing = isRecording;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // Derived, not stored: an arm only means anything while something is
  // running, so a drive that ends by any other route — the stop on
  // `/record`, a failed chunk, the tab being closed and reopened — disarms the
  // dock without needing an effect to notice.
  const armed = capturing && armedAt !== null;

  // An armed stop is a promise about the next few seconds, so it has to expire
  // on its own — otherwise a dock armed an hour ago stops the drive on the
  // next stray tap, which is the failure it exists to prevent.
  useEffect(() => {
    if (armedAt === null) return;
    const timer = setTimeout(() => setArmedAt(null), STOP_ARM_MS);
    return () => clearTimeout(timer);
  }, [armedAt]);

  useEffect(() => {
    if (!sheetOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!dockRef.current?.contains(event.target as Node)) setSheetOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSheetOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sheetOpen]);

  return (
    <div
      className="vm-dock pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center bg-gradient-to-t from-[var(--color-canvas)] via-[var(--color-canvas)]/55 to-transparent px-4 pt-14"
      /* The scrim is what makes white text on the glass readable over an
         arbitrary page; the glass alone is not opaque enough at the bottom of
         a dense board. */
    >
      <div ref={dockRef} className="pointer-events-auto flex flex-col items-center">
        {sheetOpen && <CaptureSheet onClose={() => setSheetOpen(false)} />}

        <nav
          aria-label="Main"
          className="vm-glass flex items-end gap-1 rounded-[1.75rem] p-1.5"
        >
          <RecordControl
            isRecording={capturing}
            isBusy={isBusy}
            armed={armed}
            elapsedMs={recorder.elapsedMs}
            sheetOpen={sheetOpen}
            onToggleSheet={() => setSheetOpen((v) => !v)}
            onPress={() => {
              if (!capturing) {
                startRecording();
                // A new drive opens in the conversation view, wherever it
                // was started: starting one from the workspace used to leave
                // the person there, not seeing that anything had begun.
                // Straight away rather than once the microphone is open, so
                // the second that takes is spent on the right screen.
                push("/record");
                return;
              }
              if (!armed) {
                setArmedAt(Date.now());
                return;
              }
              setArmedAt(null);
              stopRecording();
            }}
          />

        </nav>
      </div>
    </div>
  );
}

/**
 * The record button and the chevron that tunes it.
 *
 * Round, and the only saturated thing in the dock: it is the one control the
 * whole app is arranged around. It changes rather than moves between states —
 * idle shows a microphone, a running drive shows a stop glyph inside a
 * breathing halo with the elapsed time where the label was — so the thing
 * under your thumb never relocates mid-drive.
 *
 * BLUE AT REST, RED WHILE LISTENING. It used to be red in both states, so the
 * only difference between "the microphone is open" and "it is not" was a
 * glyph and a halo — and a participant glancing down could not tell which it
 * was. The fill is now the state: red means it is listening, nothing else.
 *
 * The chevron is a second, smaller target sitting inside the circle, below
 * the glyph. It opens the setting/voice/language sheet, which is what
 * "fine-tune before you start" means here.
 */
function RecordControl({
  isRecording,
  isBusy,
  armed,
  elapsedMs,
  sheetOpen,
  onToggleSheet,
  onPress,
}: {
  isRecording: boolean;
  isBusy: boolean;
  armed: boolean;
  elapsedMs: number;
  sheetOpen: boolean;
  onToggleSheet: () => void;
  onPress: () => void;
}) {
  const label = isBusy
    ? "…"
    : isRecording
      ? armed
        ? "Tap to stop"
        : formatOffset(elapsedMs)
      : "Record";

  return (
    /* The circle is taller than the tabs and the nav bottom-aligns its
       children, so it rises out of the dock rather than sitting in it. The
       glyph and the chevron are both positioned against THIS box, not against
       the button — one cannot nest a button inside a button, and the chevron
       has to be its own target. */
    <div className="relative flex w-[5.5rem] flex-col items-center gap-1 px-1 pb-2.5">
      <button
        type="button"
        disabled={isBusy}
        onClick={onPress}
        aria-label={
          isRecording
            ? armed
              ? "Tap again to stop recording"
              : "Stop recording"
            : "Start recording"
        }
        aria-pressed={isRecording}
        className={[
          "relative flex size-[4.5rem] cursor-pointer items-start justify-center rounded-full pt-[0.875rem] text-white",
          "transition-[transform,background-color] active:scale-95 disabled:cursor-default disabled:opacity-50",
          isRecording ? "bg-[var(--color-accent)]" : "bg-[var(--color-idle)]",
          isRecording && !armed ? "vm-recording" : "",
          armed ? "ring-2 ring-fg ring-offset-2 ring-offset-transparent" : "",
        ].join(" ")}
      >
        {isRecording && <MicLevel />}
        {isRecording ? (
          <Square size={22} fill="currentColor" aria-hidden className="relative" />
        ) : (
          <Mic size={24} aria-hidden />
        )}
      </button>

      {/* Inside the circle, under the glyph — the whole nub sits within the
          72px disc, which is what makes it read as part of the record button
          rather than as something stuck to its edge. It points up because that
          is where the sheet appears. `before:` widens the hit box to ~44px
          without widening what is drawn. */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-label="Recording settings"
        onClick={onToggleSheet}
        className={[
          "absolute top-[2.5rem] left-1/2 flex h-4 w-7 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full",
          "transition-colors before:absolute before:-inset-2 before:content-['']",
          sheetOpen ? "bg-black/55 text-white" : "bg-black/25 text-white/85 hover:bg-black/45 hover:text-white",
        ].join(" ")}
      >
        <ChevronUp
          size={13}
          aria-hidden
          className={sheetOpen ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>

      <span
        className={[
          "text-[0.6875rem] leading-none font-medium tabular-nums",
          isRecording ? "text-fg" : "text-fg/60",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * The sheet behind the chevron.
 *
 * Before a drive it is the two choices that are about to be fixed; during
 * one it is a statement of what they were fixed at, plus the way back to the
 * live recorder. It never offers a mid-drive change, because there is no such
 * thing — see `capture-settings.tsx`.
 */
function CaptureSheet({ onClose }: { onClose: () => void }) {
  const { isRecording, talkback } = useCapture();
  const capturing = isRecording;

  return (
    <div
      role="dialog"
      aria-label="Recording settings"
      className="vm-glass vm-rise mb-3 flex w-[min(22rem,calc(100vw-2rem))] flex-col items-center gap-4 rounded-3xl p-5"
    >
      {capturing ? (
        <>
          <p className="text-center text-sm text-fg/70">
            Voice and language for this recording
          </p>
          <LockedSummary />
          {TALKBACK_ENABLED && talkback.status === "degraded" && (
            <p className="text-center text-xs text-amber-300">
              Talk-back is offline. The recording itself is unaffected.
            </p>
          )}
          <Link
            href="/record"
            onClick={onClose}
            className="w-full rounded-full bg-fg/10 px-4 py-2 text-center text-sm font-medium text-fg hover:bg-fg/20"
          >
            Show conversation
          </Link>
        </>
      ) : (
        <>
          <VoicePicker />
          <LanguagePicker />
        </>
      )}
    </div>
  );
}
