"use client";

import {
  ChevronUp,
  LayoutGrid,
  ListTree,
  Mic,
  Square,
  SquareKanban,
  type LucideIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatOffset } from "@voicemural/shared";
import { SETTING_PROFILES } from "@voicemural/talkback/setting";
import { TALKBACK_ENABLED, useCapture } from "./capture-provider";
import {
  LanguagePicker,
  LockedSummary,
  SettingPicker,
  VoicePicker,
} from "./capture-settings";
import { MicLevel } from "./mic-level";
import { Link } from "./nav-link";

/**
 * How long an armed stop stays armed, in ms.
 *
 * The dock's record button is 72px in the corner of a page someone is reading,
 * not the 224px target on `/record` that is meant to be hit without looking —
 * so here, and only here, stopping takes two taps. A drive cut short by a
 * mis-tap is not a cosmetic bug: the ledger is the study's measurement record,
 * and the minutes after the mis-tap do not exist anywhere else. The second tap
 * is the deliberate one; if it does not come, the recording carries on.
 */
const STOP_ARM_MS = 4_000;

interface Tab {
  href: string;
  label: string;
  Icon: LucideIcon;
}

const WORKSPACE: Tab = { href: "/workspace", label: "Workspace", Icon: LayoutGrid };
const BOARD: Tab = { href: "/board", label: "Board", Icon: SquareKanban };
const TIMELINE: Tab = { href: "/timeline", label: "Timeline", Icon: ListTree };

/**
 * The dock: two surfaces and the record button, on every signed-in page.
 *
 * Replaces the per-page header navs, which had drifted into five different
 * link sets, and the `TimelineActions` bar that only the timeline had. The
 * reason it is worth having everywhere is the recorder above it: capture now
 * outlives a client navigation (see `capture-provider.tsx`), so "ready to
 * record" is a property of the app rather than of one route, and the control
 * that starts and stops a drive should be too.
 *
 * Only three destinations, because a tab bar is a claim about what the app is
 * for. The workspace and the board are the two folds of the op log a
 * participant works IN; everything else — the timeline, the trajectory, the
 * repertoire — is a way of reading the corpus afterwards, and those live in
 * the overflow menu at the top right.
 *
 * The board is gated per participant on `user.board_enabled_at` (the study has
 * a before and an after), so it cannot be the permanent right-hand tab. When
 * it is off, the timeline takes that slot rather than leaving the dock
 * lopsided — it is also in the menu, and one duplicated link is cheaper than a
 * bar whose shape changes meaning between study phases.
 */
export function AppDockClient({ boardEnabled }: { boardEnabled: boolean }) {
  const pathname = usePathname();
  const { isRecording, isDebriefing, isBusy, recorder, startRecording, stopRecording, finishDebrief } =
    useCapture();

  /* THE MICROPHONE IS OPEN IN BOTH STATES, and the dock has to treat them the
   * same or it offers Record on top of a live recording — a second drive
   * started while the first is still capturing. So the control is "active"
   * through the debrief too; what an armed press does is the only difference. */
  const capturing = isRecording || isDebriefing;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // Derived, not stored: an arm only means anything while something is
  // running, so a drive that ends by any other route — the big button on
  // `/record`, a failed chunk, the tab being closed and reopened — disarms the
  // dock without needing an effect to notice.
  const armed = capturing && armedAt !== null;

  // `/record` is the full-screen recorder: its own 224px button is the
  // transport, and a second one in the dock would be two controls for one
  // action. The tabs stay, because leaving the recorder mid-drive is the
  // whole point of hoisting capture out of the page.
  const onRecorder = pathname.startsWith("/record");

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

  const right = boardEnabled ? BOARD : TIMELINE;

  return (
    <div
      className="vm-dock pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center bg-gradient-to-t from-[var(--color-ink)] via-[var(--color-ink)]/55 to-transparent px-4 pt-14"
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
          <DockTab tab={WORKSPACE} active={pathname.startsWith(WORKSPACE.href)} />

          {!onRecorder && (
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
                  return;
                }
                if (!armed) {
                  setArmedAt(Date.now());
                  return;
                }
                setArmedAt(null);
                // Stop opens the debrief; a second press closes it. The three
                // questions are on `/record`, which is where the participant
                // has just come from — this is the escape hatch for somebody
                // who wandered off mid-debrief, not the way it is meant to end.
                if (isDebriefing) finishDebrief();
                else stopRecording();
              }}
            />
          )}

          <DockTab tab={right} active={pathname.startsWith(right.href)} />
        </nav>
      </div>
    </div>
  );
}

function DockTab({ tab, active }: { tab: Tab; active: boolean }) {
  const { Icon, href, label } = tab;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "flex w-[5.5rem] flex-col items-center gap-1 rounded-[1.375rem] px-2 py-2.5 transition-colors",
        active
          ? "bg-white/10 text-white"
          : "text-white/45 hover:bg-white/5 hover:text-white/80",
      ].join(" ")}
    >
      <Icon size={20} aria-hidden />
      <span className="text-[0.6875rem] leading-none font-medium">{label}</span>
    </Link>
  );
}

/**
 * The record button and the chevron that tunes it.
 *
 * Round, accent-filled, and the only saturated thing in the dock: it is the
 * one control the whole app is arranged around. It changes rather than moves
 * between states — idle shows a microphone, a running drive shows a stop glyph
 * inside a breathing halo with the elapsed time where the label was — so the
 * thing under your thumb never relocates mid-drive.
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
          "transition-transform active:scale-95 disabled:cursor-default disabled:opacity-50",
          "bg-[var(--color-accent)]",
          isRecording && !armed ? "vm-recording" : "",
          armed ? "ring-2 ring-white ring-offset-2 ring-offset-transparent" : "",
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
          isRecording ? "text-white" : "text-white/60",
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
 * Before a drive it is the three choices that are about to be fixed; during
 * one it is a statement of what they were fixed at, plus the way back to the
 * live recorder. It never offers a mid-drive change, because there is no such
 * thing — see `capture-settings.tsx`.
 */
function CaptureSheet({ onClose }: { onClose: () => void }) {
  const { isRecording, setting, source, talkback } = useCapture();

  return (
    <div
      role="dialog"
      aria-label="Recording settings"
      className="vm-glass vm-rise mb-3 flex w-[min(22rem,calc(100vw-2rem))] flex-col items-center gap-4 rounded-3xl p-5"
    >
      {isRecording ? (
        <>
          <p className="text-center text-sm text-white/70">
            Recording. These are fixed for this drive.
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
            className="w-full rounded-full bg-white/10 px-4 py-2 text-center text-sm font-medium text-white hover:bg-white/20"
          >
            Open the live view
          </Link>
        </>
      ) : (
        <>
          <p className="text-center text-sm text-white/60">
            {source === "chosen" ? "Set to " : "Looks like "}
            <span className="text-white/90">{SETTING_PROFILES[setting].label}</span>
            <span className="mt-0.5 block text-xs text-white/35">
              {SETTING_PROFILES[setting].hint}
            </span>
          </p>
          <SettingPicker />
          <VoicePicker />
          <LanguagePicker />
        </>
      )}
    </div>
  );
}
