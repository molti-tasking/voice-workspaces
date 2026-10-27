"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { earcon } from "@/lib/recorder/earcon";
import { useFloorPreference, type Floor } from "@/lib/recorder/floor-store";
import { useSttLanguage } from "@/lib/recorder/language-store";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { useVoice } from "@/lib/recorder/voice-store";
import {
  createConversationStore,
  currentTitle,
  draftMajor,
  linesForReconnect,
  titlesForReconnect,
  type ConversationMessage,
  type ConversationStore,
} from "@/lib/talkback/conversation";
import { createKeepWatcher } from "@/lib/talkback/keep-watcher";
import { replayConversation, seedMessages, type DriveRecord } from "@/lib/talkback/replay";
import { createSparkLedger, sparkKey, type SparkLedger } from "@/lib/talkback/spark-ledger";
import { postSubjectSignals, subjectSignalsBody } from "@/lib/talkback/subject-signals";
import type { SparkRequest } from "@/lib/talkback/types";
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

/** How often a "keep this one" that has not been acted on yet is looked at again. */
const KEEP_CHECK_MS = 500;

/** How often the sparks on offer are worked out again with no new talk: a subject fades with time. */
const SPARK_REFRESH_MS = 30_000;

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
   * Both sides of this drive's conversation, by subject and in order, with the
   * drafts and pulled sparks placed in it — what the recorder shows. A store
   * rather than a value, because it changes every few hundred milliseconds
   * while the agent talks and only the conversation needs to hear about that;
   * read it with `useSyncExternalStore`. Replaced when the
   * next drive starts, and kept after this one ends, like the rest of the view.
   */
  conversation: ConversationStore;
  /**
   * The sparks this drive has shown and the ones pulled, beside the
   * conversation they are about and replaced with it. See `spark-ledger.ts`.
   */
  sparks: SparkLedger;
  /**
   * The running drive lets them KEEP subjects — its spark selection is
   * `chosen` — so each subject shows Keep, and "keep this one" is heard.
   */
  keepable: boolean;
  /** What the conversation is about now, from `conversation`. Kept after Stop. */
  title: string | null;
  /**
   * Who may talk, as the person chose it — remembered on this device, so the
   * next drive starts the same way. What the agent is actually under is
   * `talkback.floor`; the two differ only while a change is on its way.
   */
  floor: Floor;
  setFloor: (next: Floor) => void;
  /**
   * Ask the agent for one turn now, whichever floor is in force — carrying a
   * spark when they pulled one.
   */
  poke: (spark?: SparkRequest) => Promise<PokeResult | null>;
  /**
   * Rename a subject: their own name for it, on the screen, on the stored
   * subject (the recall probe and My week ask by it) and to the agent, which
   * calls it that from then on (talkback-23). Works after Stop too, while the
   * conversation is still on screen. False when the conversation refused it:
   * empty, or a name another subject of this drive already has.
   */
  renameSubject: (ordinal: number, title: string) => boolean;
  /**
   * The drafts written on this drive, which the conversation opens where they
   * were written, and the cues. Frozen at Stop and kept, like the title.
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

  /**
   * The display study's interruption: the agent is silenced and stops
   * listening while the recording goes on (`pause` in bot.py). For the
   * running drive only — the next one always starts unpaused.
   */
  agentPaused: boolean;
  pauseAgent: (paused: boolean) => void;

  /** Start a drive with whatever is currently selected. Safe to call twice. */
  startRecording: () => void;
  /**
   * Start a drive that continues a past conversation: it opens with that
   * conversation on screen, the agent is told what was said in it, and the
   * new drive is stored as its continuation (`continues_id`).
   */
  continueRecording: (fromCaptureSessionId: string) => void;
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
  const [sparks, setSparks] = useState(createSparkLedger);
  const [conversationFor, setConversationFor] = useState(conversationId);
  // A past conversation waiting to be put on screen for the drive that
  // continues it (`continueRecording`): it goes into that drive's new store,
  // before the container says anything.
  const [seed, setSeed] = useState<ConversationMessage[] | null>(null);
  if (conversationFor !== conversationId) {
    setConversationFor(conversationId);
    const next = createConversationStore();
    if (seed && conversationId !== null && conversationId === recorder.currentSessionId) {
      for (const message of seed) next.dispatch(message);
      setSeed(null);
    }
    setConversation(next);
    setSparks(createSparkLedger());
  }
  const title = useSyncExternalStore(
    conversation.subscribe,
    () => currentTitle(conversation.getSnapshot()),
    () => null,
  );

  // Armed with the recording, for the whole drive — there is no separate
  // gesture to enter it. Everything it does is downstream of the microphone
  // stream the recorder publishes, so capture is unaffected either way.
  // Paused for one drive only: kept with the drive it was asked on, so the
  // next drive reads unpaused without anything having to remember to undo it.
  const [pause, setPause] = useState<{ sessionId: string | null; paused: boolean }>({
    sessionId: null,
    paused: false,
  });
  const agentPaused = pause.paused && pause.sessionId === recorder.currentSessionId;
  const pauseAgent = useCallback(
    (paused: boolean) => setPause({ sessionId: recorder.currentSessionId, paused }),
    [recorder.currentSessionId],
  );

  const {
    state: talkback,
    poke,
    offerSparks,
    renameSubject: tellRename,
  } = useTalkback({
    captureSessionId: recorder.currentSessionId,
    enabled: TALKBACK_ENABLED && isRecording,
    floor,
    paused: agentPaused,
    onMessage: conversation.dispatch,
    titles: () => titlesForReconnect(conversation.getSnapshot()),
    history: () => linesForReconnect(conversation.getSnapshot()),
  });

  // THE SPARKS ON OFFER, worked out here rather than on `/record`: the
  // container is told about them wherever the person is, so a spark can be
  // asked for out loud with the phone in a pocket. Subscribed outside React's
  // render, so a conversation that changes every few hundred milliseconds
  // does not re-render everything that reads this context; and on a clock
  // too, because a subject fades with time and not only with talk.
  // The control arm offers nothing, by screen or by voice — the signals are
  // still worked out, and kept at Stop, because whether they predict recall
  // is half the question.
  const sparksArm = recorder.sparksArm;
  // Who picks the subjects the sparks are on: the signals, or the person, who
  // KEEPS the ones they want to hold in their own head (`signals.ts`).
  const sparkSelection = recorder.sparkSelection;
  const keepable = sparksArm && sparkSelection === "chosen";
  useEffect(() => {
    if (!isRecording) return;
    const refresh = () => sparks.refresh(conversation.getSnapshot(), Date.now(), sparkSelection);
    refresh();
    const unsubscribe = conversation.subscribe(refresh);
    const timer = window.setInterval(refresh, SPARK_REFRESH_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [isRecording, conversation, sparks, sparkSelection]);

  // KEEPING BY VOICE: "keep this one", with the phone untouched. Heard in their
  // own turns (`keep-watcher.ts`), filed on the subject it was said under, and
  // confirmed with a short tone rather than by the agent, which is told to let
  // it pass (SPARK_SECTION). On a clock as well as on every change, because a
  // keep command is only acted on once it has stood for a moment.
  useEffect(() => {
    if (!isRecording || !keepable) return;
    const watcher = createKeepWatcher();
    const check = () => {
      for (const action of watcher.observe(conversation.getSnapshot(), Date.now())) {
        conversation.dispatch({
          type: "keep",
          ordinal: action.ordinal,
          kept: action.request === "keep",
          via: "voice",
        });
        earcon(action.request === "keep" ? "kept" : "unkept");
      }
    };
    check();
    const unsubscribe = conversation.subscribe(check);
    const timer = window.setInterval(check, KEEP_CHECK_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [isRecording, keepable, conversation]);

  // EACH SPARK ITS OWN QUESTION, in the sparks arm: written once per spark
  // from that subject's lines (`/api/realtime/spark-question`), shown on the
  // chip and asked by the agent when it is pulled. Until one arrives, or if
  // none comes, the chip keeps its kind's label and the agent its generic
  // question — nothing waits on this.
  const asking = useRef(new Set<string>());
  const questionsFor = recorder.currentSessionId;
  useEffect(() => {
    if (!sparksArm || !questionsFor) return;
    const fetchMissing = () => {
      const { offered, questions } = sparks.getSnapshot();
      for (const spark of offered) {
        const key = sparkKey(spark);
        if (questions.has(key) || asking.current.has(key)) continue;
        asking.current.add(key);
        const section = conversation.getSnapshot().sections.find((s) => s.ordinal === spark.ordinal);
        const lines = (section?.turns ?? []).map((t) => ({ who: t.who, text: t.text }));
        void fetch("/api/realtime/spark-question", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureSessionId: questionsFor, kind: spark.kind, title: spark.title, lines }),
        })
          .then((res) => (res.ok ? (res.json() as Promise<{ question?: string | null }>) : null))
          .then((body) => {
            if (body?.question) sparks.setQuestion(spark, body.question);
          })
          .catch(() => undefined);
      }
    };
    fetchMissing();
    return sparks.subscribe(fetchMissing);
  }, [sparks, conversation, sparksArm, questionsFor]);
  useEffect(() => {
    const send = () => offerSparks(sparksArm ? sparks.getSnapshot().offered : []);
    send();
    return sparks.subscribe(send);
  }, [sparks, offerSparks, sparksArm]);

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

  // Each draft as a line in the conversation, after the turn that wrote it
  // (talkback-23). Handed in whenever the drafts change: the store places each
  // version the agent wrote once and ignores it after, so nothing is kept here.
  useEffect(() => {
    for (const draft of cues.drafts) {
      conversation.dispatch({
        type: "mark",
        mark: { kind: "draft", draftId: draft.id, major: draftMajor(draft.version) },
      });
    }
  }, [cues.drafts, conversation]);

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

  // One Continue at a time: the fetch below comes before the recorder is
  // busy, and a second tap in that gap would start a second drive.
  const continuing = useRef(false);
  const continueRecording = useCallback(
    (from: string) => {
      if (continuing.current) return;
      continuing.current = true;
      void (async () => {
        try {
          // The conversation just stopped is still on screen, complete: the
          // stored one may still be missing chunks that are uploading.
          const onScreen = from === conversationId ? conversation.getSnapshot() : null;
          let messages: ConversationMessage[] | null = null;
          if (onScreen && onScreen.sections.length > 0) messages = seedMessages(onScreen);
          else {
            // What was said, to put back on screen. Fails open: the drive
            // still continues the conversation (the agent is told on the
            // server), it just starts with an empty screen.
            const drives = await fetch(`/api/conversations/${from}`)
              .then((res) => (res.ok ? (res.json() as Promise<{ drives: DriveRecord[] }>) : null))
              .then((body) => body?.drives ?? null)
              .catch(() => null);
            if (drives) messages = seedMessages(replayConversation(drives));
          }
          if (messages) setSeed(messages);
          const started = await start(voiceId, sttLanguage, conditionOverride, from);
          // No drive started — the microphone refused, say: the seed must not
          // wait for the next, unrelated one.
          if (!started) setSeed(null);
        } finally {
          continuing.current = false;
        }
      })();
    },
    [start, voiceId, sttLanguage, conditionOverride, conversationId, conversation],
  );

  // What the recorder worked out about each subject, kept at Stop — with the
  // arm on or off, because whether the signals predict recall is half the
  // question — and as a best effort whenever the page is hidden mid-drive,
  // since a drive often ends by the phone going in a pocket rather than by
  // Stop. Counts and enums by ordinal only (`subject-signals.ts`).
  const keepSignals = useCallback(
    (final: boolean) => {
      if (!sessionId) return;
      postSubjectSignals(
        subjectSignalsBody(
          sessionId,
          conversation.getSnapshot(),
          sparks.getSnapshot(),
          Date.now(),
          final,
        ),
      );
    },
    [sessionId, conversation, sparks],
  );
  useEffect(() => {
    if (!isRecording) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") keepSignals(false);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [isRecording, keepSignals]);

  const renameSubject = useCallback(
    (ordinal: number, title: string) => {
      const before = conversation.getSnapshot();
      conversation.dispatch({ type: "rename", ordinal, title });
      const renamed = conversation.getSnapshot();
      if (renamed === before) return false;
      const name = renamed.sections.find((s) => s.ordinal === ordinal)?.title;
      if (!name) return false;
      tellRename(ordinal, name);
      // Fire and forget, like the signals: the name on screen and with the
      // agent stands whether or not this lands. Never logged — it is content.
      if (conversationId) {
        void fetch(`/api/capture-sessions/${conversationId}/subjects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ordinal, title: name }),
          keepalive: true,
        }).catch(() => undefined);
      }
      return true;
    },
    [conversation, conversationId, tellRename],
  );

  const stopRecording = useCallback(() => {
    keepSignals(true);
    void stop();
  }, [stop, keepSignals]);

  const value = useMemo<CaptureContextValue>(
    () => ({
      recorder,
      talkback,
      conversationId,
      conversation,
      sparks,
      keepable,
      title,
      floor,
      setFloor,
      poke,
      renameSubject,
      cues,
      isRecording,
      isBusy,
      conditionOverride,
      toggleCondition,
      voiceId,
      chooseVoice,
      sttLanguage,
      chooseSttLanguage,
      agentPaused,
      pauseAgent,
      startRecording,
      continueRecording,
      stopRecording,
    }),
    [
      recorder,
      talkback,
      conversationId,
      conversation,
      sparks,
      keepable,
      title,
      floor,
      setFloor,
      poke,
      renameSubject,
      cues,
      isRecording,
      isBusy,
      conditionOverride,
      toggleCondition,
      voiceId,
      chooseVoice,
      sttLanguage,
      chooseSttLanguage,
      agentPaused,
      pauseAgent,
      startRecording,
      continueRecording,
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

