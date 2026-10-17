"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
// The `/screen` subpath, not the package index — see capture-settings.tsx.
// The `/profile` subpath for the same reason: the index drags in the database.
import { PROFILE } from "@voicemural/talkback/profile";
import { screenFor } from "@voicemural/talkback/screen";
import { useCues, type CueState } from "@/lib/display/use-cues";
import {
  useConditionOverride,
  type ConditionOverride,
  type ToggleableFlag,
} from "@/lib/recorder/condition-store";
import { useFloorPreference, type Floor } from "@/lib/recorder/floor-store";
import { useSttLanguage } from "@/lib/recorder/language-store";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { useVoice } from "@/lib/recorder/voice-store";
import {
  createConversationStore,
  currentTitle,
  titlesForReconnect,
  type ConversationStore,
} from "@/lib/talkback/conversation";
import { useTalkback, type PokeResult, type TalkbackState } from "@/lib/talkback/use-talkback";

/**
 * Whether talk-back is built into this bundle.
 *
 * A build-time flag, like the PostHog token, because it decides whether the
 * conversational path exists at all for a participant. Unset means capture
 * behaves exactly as it did before: no socket, no worklet, nothing to go wrong.
 */
export const TALKBACK_ENABLED =
  process.env.NEXT_PUBLIC_TALKBACK_ENABLED === "true";

export interface CaptureContextValue {
  recorder: ReturnType<typeof useRecorder>;
  talkback: TalkbackState;
  /**
   * The drive the conversation view is showing: the running one, or the one
   * that just ended. Null only before the first drive of this page load.
   *
   * The conversation stays on screen after Stop and after Done — the subject,
   * the cues and the drafts used to vanish at the moment a person most wants to
   * look at them (6 Oct 2026). It is replaced when the next drive starts.
   */
  conversationId: string | null;
  /**
   * Both sides of this drive's conversation, by subject — what the recorder's
   * two panels show. A store rather than a value, because it changes every few
   * hundred milliseconds while the agent talks and only the panels need to
   * hear about that; read it with `useSyncExternalStore`. Replaced when the
   * next drive starts, and kept after this one ends, like the rest of the view.
   */
  conversation: ConversationStore;
  /** What the conversation is about now, from `conversation`. Kept after Stop. */
  title: string | null;
  /**
   * Who may talk, as the person chose it — remembered on this device, so the
   * next drive starts the same way. What the agent is actually under is
   * `talkback.floor`; the two differ only while a change is on its way.
   */
  floor: Floor;
  setFloor: (next: Floor) => void;
  /** Ask the agent for one turn now, whichever floor is in force. */
  poke: () => Promise<PokeResult | null>;
  /**
   * What the record screen shows under the title: cues and the drafts written
   * on this drive. Frozen at Stop and kept, like the title.
   *
   * Held here, not on `/record`, for the reason the recorder is: state that
   * belongs to the drive must not belong to a route. On the page it was
   * dropped on every navigation, so coming back from the timeline mid-drive
   * found the panel empty until a new stream had connected and ticked — and
   * the drafts the agent had just written "gone" (27 Sep 2026). One stream
   * now runs for the whole drive, whichever screen is open.
   */
  cues: CueState;
  isRecording: boolean;
  /** True while the microphone is being opened or the last chunk closed out. */
  isBusy: boolean;

  /**
   * A per-drive override of the study condition, for the pilot's cold-start
   * test. Sparse, and honoured by the server only for pilot accounts — see
   * `condition-store.ts`.
   */
  conditionOverride: ConditionOverride;
  toggleCondition: (flag: ToggleableFlag, value: boolean | null) => void;

  voiceId: string;
  chooseVoice: (next: string) => void;
  sttLanguage: string | null;
  chooseSttLanguage: (next: string | null) => void;

  /** Start a drive with whatever is currently selected. Safe to call twice. */
  startRecording: () => void;
  stopRecording: () => void;
}

const CaptureContext = createContext<CaptureContextValue | null>(null);

/**
 * The one recorder in the app, held above the router.
 *
 * This lives in the root layout rather than on `/record`, and that placement is
 * the whole point. A `MediaRecorder` loop, a wake lock and a WebRTC peer
 * connection are all owned by React state, so while they hung off the recorder
 * *page* a client navigation unmounted them — which meant a drive could not
 * outlive looking at the board, and the dock could not offer a record button
 * anywhere else. Hoisting it here makes "recording" a property of the session
 * rather than of the route, so the participant can read their workspace, move a
 * card and come back while still talking.
 *
 * It also closes a latent bug: `useRecorder` has no unmount teardown (there is
 * nothing sensible it could do — stopping a drive because a component went away
 * is worse than the alternative), so two mounted copies would have raced for
 * the microphone. Above the router there is exactly one, by construction.
 *
 * Nothing here reaches the ledger. Capture still runs entirely inside
 * `useRecorder`; talk-back still only taps the stream the recorder publishes.
 * With `NEXT_PUBLIC_TALKBACK_ENABLED` unset, `useTalkback` returns `OFF`
 * without opening anything.
 */
export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const recorder = useRecorder();
  const isRecording = recorder.status === "recording";
  const isBusy = recorder.status === "requesting" || recorder.status === "stopping";

  // Per-browser preferences, remembered across visits. See their stores.
  const [voiceId, chooseVoice] = useVoice();
  const [sttLanguage, chooseSttLanguage] = useSttLanguage();
  const [conditionOverride, toggleCondition] = useConditionOverride();

  const [floor, setFloor] = useFloorPreference();

  // Both ids are set in the one patch that ends a drive, so this never goes
  // null between Stop and the next drive: see `finish` in use-recorder.ts.
  const conversationId = recorder.currentSessionId ?? recorder.lastSessionId;

  // One store per drive, swapped during render when the drive changes so no
  // frame shows the last drive's turns under the new one. Held here, above
  // the router, for the reason the title trail was (27 Sep 2026): walking to
  // the workspace and back mid-drive must not come back to an empty screen.
  const [conversation, setConversation] = useState(createConversationStore);
  const [conversationFor, setConversationFor] = useState(conversationId);
  if (conversationFor !== conversationId) {
    setConversationFor(conversationId);
    setConversation(createConversationStore());
  }
  const title = useSyncExternalStore(
    conversation.subscribe,
    () => currentTitle(conversation.getSnapshot()),
    () => null,
  );

  // Armed with the recording, for the whole drive — there is no separate
  // gesture to enter it. Everything it does is downstream of the microphone
  // stream the recorder publishes, so capture is unaffected either way.
  const { state: talkback, poke } = useTalkback({
    captureSessionId: recorder.currentSessionId,
    enabled: TALKBACK_ENABLED && isRecording,
    floor,
    onMessage: conversation.dispatch,
    titles: () => titlesForReconnect(conversation.getSnapshot()),
  });

  // Reads Postgres, never the voice container: the panel keeps filling with
  // talk-back dead, and survives a reload mid-recording. See the route comment.
  // The stream runs only while recording; what it showed is kept afterwards.
  const cues = useCues({
    captureSessionId: conversationId,
    budgets: {
      content: PROFILE.maxContentCues,
      directions: PROFILE.maxDirectionCues,
    },
    enabled: isRecording && PROFILE.displayAllowed,
  });

  // Which screen they have open, reported on every navigation during a drive
  // so the agent can stop describing screens it cannot see. Fire and forget:
  // a missed report means the agent is told the screen is not known, which is
  // what it was before this existed.
  const pathname = usePathname();
  const screen = screenFor(pathname);
  const sessionId = recorder.currentSessionId;
  useEffect(() => {
    if (!isRecording || !sessionId) return;
    void fetch("/api/realtime/screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureSessionId: sessionId, screen }),
      keepalive: true,
    }).catch(() => undefined);
  }, [isRecording, sessionId, screen]);

  const { start, stop } = recorder;

  const startRecording = useCallback(() => {
    void start(voiceId, sttLanguage, conditionOverride);
  }, [start, voiceId, sttLanguage, conditionOverride]);

  const stopRecording = useCallback(() => {
    void stop();
  }, [stop]);

  const value = useMemo<CaptureContextValue>(
    () => ({
      recorder,
      talkback,
      conversationId,
      conversation,
      title,
      floor,
      setFloor,
      poke,
      cues,
      isRecording,
      isBusy,
      conditionOverride,
      toggleCondition,
      voiceId,
      chooseVoice,
      sttLanguage,
      chooseSttLanguage,
      startRecording,
      stopRecording,
    }),
    [
      recorder,
      talkback,
      conversationId,
      conversation,
      title,
      floor,
      setFloor,
      poke,
      cues,
      isRecording,
      isBusy,
      conditionOverride,
      toggleCondition,
      voiceId,
      chooseVoice,
      sttLanguage,
      chooseSttLanguage,
      startRecording,
      stopRecording,
    ],
  );

  return (
    <CaptureContext.Provider value={value}>{children}</CaptureContext.Provider>
  );
}

/**
 * Read the live capture state.
 *
 * Throws outside the provider rather than returning a dead stub: a dock whose
 * record button silently did nothing is the one failure mode that would be
 * discovered mid-drive.
 */
export function useCapture(): CaptureContextValue {
  const value = useContext(CaptureContext);
  if (!value) {
    throw new Error("useCapture must be used inside <CaptureProvider>");
  }
  return value;
}

