"use client";

import { Mic, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
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
import { aiHealthProblem, useAiHealth } from "@/lib/ai-health";
import { frozenConversationStore, type DriveRecord } from "@/lib/talkback/replay";
import {
  MoreMenu,
  ViewSwitch,
  useMonitorOn,
  useRecordView,
} from "./view-switch";
import { ConversationView } from "./views/conversation-view";
import type { AskTopic } from "./views/topic-sheet";

/**
 * The recorder screen: the display study's talk screen (`block-talk.tsx`),
 * made the everyday one (2 Nov 2026).
 *
 * ONE FRAME, WHETHER THEY TALK OR NOT. The same column as the study's, a slim
 * bar at the top and the conversation under it, before a drive, during one
 * and after it. Only what is in the frame changes.
 *
 * ONE CONVERSATION THAT KEEPS GROWING (3 Nov 2026). There is no clean slate:
 * the screen opens on their conversation as it was left (`past`, read on the
 * server), and Record carries it on (`continueRecording`): the drive opens
 * with it on screen, the agent is told what was said, and it is stored as its
 * continuation. Stop leaves it on screen, and Record carries it on again.
 * Only someone who has never talked sees an empty screen, with one enormous
 * target to START and the voice and language to start with; from then on
 * those two are in the menu.
 *
 * THE STUDY'S COLUMN. The Stack was tuned for it: its topics alternate left
 * and right inside the column, and in a window five times as wide they drift
 * to opposite edges and the current topic's bubble stretches across all of it.
 *
 * NOTHING BESIDE THE CONVERSATION. The bar holds the view switch, the menu,
 * and Record or Stop, which is one button in one place: where the study's
 * Finish was. The dock stays off this screen, so the conversation has the
 * height to the bottom edge. Lock and Poke, the time bar and the ratings
 * after a drive went with the move: each one a reason to look away from the
 * turns, and none of them in the screen the study tested.
 *
 * THE WHOLE SCREEN, NOT A PAGE: the height of the viewport, with the
 * conversation scrolling inside it, so the bar never scrolls away from a
 * glance.
 */
export function RecorderClient({
  past,
}: {
  /** Their conversation as stored, to open on: its latest drive, which Record continues. Null before their first. */
  past: { lastDriveId: string; drives: DriveRecord[] } | null;
}) {
  // The recorder itself lives above the router (see capture-provider.tsx), so a
  // drive survives walking over to the board and back. This screen is the full
  // view onto it, not its owner.
  const {
    recorder: rec,
    talkback: talk,
    conversationId,
    conversation,
    cues,
    floor,
    setFloor,
    poke,
    renameSubject,
    isRecording,
    isBusy,
    startRecording,
    continueRecording,
    stopRecording,
  } = useCapture();
  const hearing = talk.status === "speaking";
  const connected = talk.status === "listening" || talk.status === "speaking";
  // How the conversation is shown: a choice of this browser, kept across
  // drives — unless the drive's study condition forces one, as the display
  // study does, and then there is no choice to offer.
  const chosen = useRecordView();
  const view = rec.display ?? chosen;
  // The comprehension monitor (draft): never on a study drive.
  const monitorOn = useMonitorOn() && rec.display === null;
  // A question from a topic's sheet, handed to the agent to ask back: a poke
  // that carries it, marked in the conversation as a pulled spark is.
  const ask: AskTopic = async (ordinal, question, kind) => {
    const result = await poke({ kind, ordinal, question });
    const taken = result === "fired" || result === "armed";
    if (taken)
      conversation.dispatch({
        type: "mark",
        mark: { kind: "spark", ordinal, spark: kind, question },
      });
    return taken;
  };
  // Whether the AI proxy answers (`/api/health/ai`): a pill when it does not,
  // and before a drive the reason and a way to see the screens anyway.
  const aiProblem = aiHealthProblem(useAiHealth());

  // No Lock on this screen any more, so a drive here starts with the floor
  // open, as the study's do (`session-flow.tsx`): a Lock remembered from
  // before would leave the agent silent with nothing on screen to lift it.
  useEffect(() => {
    if (floor !== "open") setFloor("open");
  }, [floor, setFloor]);

  // What is on screen: the drive of this page load once there is one, and
  // until then the stored conversation, which never changes on screen.
  const [pastStore] = useState(() => (past ? frozenConversationStore(past.drives) : null));
  const live = conversationId !== null;
  const onScreen = conversationId ?? past?.lastDriveId ?? null;
  const hasConversation = onScreen !== null;
  // Nothing capturing, with the conversation on screen.
  const ended = hasConversation && !isRecording;
  // Voice and language, which before a first drive sit on the empty screen.
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <main className="no-touch-fuss mx-auto flex h-dvh w-full max-w-2xl flex-col gap-2 overflow-hidden px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/*
        The bar, as the study's: a tinted band edge to edge, small type, above
        the conversation. Clear of the status bar in a standalone PWA, where
        the stop once sat under the clock.
      */}
      <header className="-mx-4 flex shrink-0 items-center justify-between gap-1.5 border-b border-line bg-fg/[0.05] px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-sm text-fg/65">
        {/* PRESENT OR ABSENT, never a shade of something. See `RecordingBadge`. */}
        {isRecording ? (
          <RecordingBadge elapsedMs={rec.elapsedMs} />
        ) : ended ? (
          // Words, not a muted badge: the badge is present or absent, and its
          // absence alone does not say the conversation below is over.
          <span className="shrink-0 text-fg/60">
            {rec.status === "requesting"
              ? "Starting…"
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
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          <StatusPills
            ai={aiProblem}
            pending={rec.pendingUploads}
            uploading={rec.uploading}
            ended={ended}
            talkback={TALKBACK_ENABLED && isRecording ? talk.status : null}
            memory={TALKBACK_ENABLED && isRecording ? talk.memory : null}
          />
          {/* The two views, one tap apart, and everything else behind the
              menu (2 Nov 2026). Not on a drive whose study condition fixes
              the view: there is nothing to choose and nowhere to wander off. */}
          {hasConversation && rec.display === null && (
            <ViewSwitch view={chosen} />
          )}
          {rec.display === null && (
            <MoreMenu
              view={chosen}
              canChooseView={hasConversation}
              {...(ended ? { onSettings: () => setSettingsOpen((open) => !open) } : {})}
            />
          )}
          {/* Stop, then Record to carry on: one button that changes rather
              than moves. Stop is one tap, no confirmation, but small,
              so a stray hand in a cradle is unlikely to find it; the ring says
              the agent is talking, wherever the eye is. Before the first drive
              the start is the large target below instead. */}
          {isRecording ? (
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
          ) : onScreen !== null ? (
            <button
              type="button"
              onClick={() => continueRecording(onScreen)}
              disabled={isBusy}
              aria-label="Record, continuing this conversation"
              className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-[var(--color-idle)] text-white transition-transform active:scale-95 disabled:opacity-50"
            >
              <Mic size={18} aria-hidden />
            </button>
          ) : null}
        </div>
      </header>

      {settingsOpen && ended && (
        <section
          aria-label="Voice and language"
          className="flex shrink-0 flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-4"
        >
          <VoicePicker />
          <LanguagePicker />
          {/* Pilot builds only, and pilot accounts only. See `ConditionToggles`. */}
          <ConditionToggles />
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="min-h-9 cursor-pointer rounded-full px-4 text-sm font-medium text-fg/70 hover:bg-fg/[0.06] hover:text-fg"
          >
            Done
          </button>
        </section>
      )}

      {live ? (
        <ConversationView
          // Keyed by the drive: each drive's store is new, seeded with the
          // conversation it carries on (capture-provider.tsx).
          key={conversationId}
          view={view}
          store={conversation}
          status={
            TALKBACK_ENABLED && isRecording
              ? {
                  floor: connected ? (talk.floor ?? floor) : null,
                  // The agent first: its own voice can reach the microphone.
                  speaking: hearing,
                  listening: !hearing && talk.userSpeaking,
                  thinking: talk.thinking,
                  lookingUp: talk.lookingUp,
                }
              : null
          }
          live={isRecording}
          captureSessionId={conversationId}
          // "It is listening" is true only while it is.
          placeholder={isRecording ? PROFILE.hint : undefined}
          drafts={cues.drafts}
          // During the drive and after it: tidying the topics is a thing to do
          // once there is time to read them.
          onRename={renameSubject}
          monitor={monitorOn}
          {...(TALKBACK_ENABLED && isRecording && connected
            ? { onAsk: ask }
            : {})}
          className="min-h-0 flex-1"
        />
      ) : pastStore && past ? (
        // The conversation as it was left, until Record carries it on.
        <ConversationView
          key="past"
          view={view}
          store={pastStore}
          live={false}
          captureSessionId={past.lastDriveId}
          monitor={monitorOn}
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto py-4">
          <button
            type="button"
            onClick={startRecording}
            disabled={isBusy}
            className={[
              "relative flex size-56 shrink-0 cursor-pointer items-center justify-center rounded-full text-2xl font-medium",
              "bg-surface text-fg ring-1 ring-line transition-transform active:scale-95 disabled:opacity-50 sm:size-64",
            ].join(" ")}
          >
            {isBusy ? "…" : "Record"}
          </button>

          <p className="min-h-5 max-w-xs text-center text-sm text-fg/60">
            {isBusy ? (
              // A tap that opens a microphone takes about a second, and until
              // now that second showed an ellipsis on a disabled button — which
              // reads as "it did not hear me" and invites a second tap.
              <span className="text-fg/60">
                {rec.status === "requesting"
                  ? "Opening the microphone…"
                  : "Saving…"}
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
      )}


      <div className="shrink-0 space-y-3 text-sm">
        {aiProblem && !hasConversation && (
          <Notice tone="warn" title="The AI server is not available">
            <div className="space-y-2">
              <p>
                A conversation would get no answers right now. {aiProblem}
              </p>
              <Link
                href="/record/demo"
                className="inline-block rounded bg-fg/10 px-3 py-1.5 font-medium text-fg hover:bg-fg/20"
              >
                Try a simulated conversation
              </Link>
            </div>
          </Notice>
        )}
        <Notices />
      </div>
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

function StatusPills({
  ai,
  pending,
  uploading,
  ended,
  talkback,
  memory,
}: {
  /** What is wrong with the AI server, or null when it answers. */
  ai: string | null;
  pending: number;
  uploading: boolean;
  /** A drive has ended on this screen: what "synced" is about. */
  ended: boolean;
  talkback: string | null;
  memory: "ready" | "unavailable" | null;
}) {
  // Nothing at all when there is nothing to say: an empty group still takes a
  // gap in the bar, and at 360px the bar has none to spare.
  const any =
    ai !== null ||
    talkback === "degraded" ||
    talkback === "connecting" ||
    memory === "unavailable" ||
    pending > 0 ||
    ended;
  if (!any) return null;
  return (
    // Shrinks and wraps, so a warning never pushes the stop off the screen.
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 overflow-hidden text-xs">
      {/* Only worth showing when it is NOT working. A healthy socket needs no
          pill: the panels filling with what is said is the evidence, and a car
          dashboard should not carry an indicator for every subsystem that is
          fine. */}
      {/* Before and during a drive: without the AI there are no answers. */}
      {ai && <Pill label="AI offline" tone="warn" title={ai} />}
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
      {pending === 0 && ended && <Pill label="synced" tone="ok" />}
    </div>
  );
}

function Pill({
  label,
  tone,
  title,
}: {
  label: string;
  tone: "ok" | "warn";
  title?: string;
}) {
  return (
    // Shrinks to an ellipsis rather than overflowing: wrapping only helps
    // when there are several pills, and one pill wider than the space left
    // beside the stop spilled over what sat next to it (390px, "talk…").
    <span
      title={title ?? label}
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
