"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { CaptureSetting } from "@voicemural/shared";
import {
  useConditionOverride,
  type ConditionOverride,
  type ToggleableFlag,
} from "@/lib/recorder/condition-store";
import {
  rememberSetting,
  useDetectedSetting,
  type SettingSource,
} from "@/lib/recorder/detect-setting";
import { useSttLanguage } from "@/lib/recorder/language-store";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { useVoice } from "@/lib/recorder/voice-store";
import { useTalkback, type TalkbackState } from "@/lib/talkback/use-talkback";
 
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
  isRecording: boolean;
  /**
   * The post-drive debrief: Stop has been tapped, the three questions are on
   * screen, and the microphone is STILL OPEN for the answers.
   *
   * Separate from `isRecording` on purpose. Capture carries on — the chunk
   * loop, the wake lock and the uploader do not know the difference — but
   * talk-back does not, because these answers are the study's channel and an
   * agent replying to them would be talking over the one part of a drive it
   * is not in.
   */
  isDebriefing: boolean;
  /** True while the microphone is being opened or the last chunk closed out. */
  isBusy: boolean;

  /** The setting this recording would run under: corrected, or detected. */
  setting: CaptureSetting;
  /** Where that answer came from, which is what `recording_started` reports. */
  source: SettingSource;
  /** Null until the person corrects the detector; the correction is remembered. */
  chosenSetting: CaptureSetting | null;
  chooseSetting: (next: CaptureSetting | null) => void;
  /**
   * Whether the setting is still a guess nobody has confirmed.
   *
   * True only while `source` is `default`: no laptop, no accelerometer, no
   * remembered answer. The recorder asks rather than starting, because the
   * fallback is `driving` — 25-word replies and no screen — and Pilot 01 ran
   * a stationary first-time user under exactly that.
   */
  settingUnknown: boolean;
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
  /** Done with the three questions: close the window and end the recording. */
  finishDebrief: () => void;
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
  const isDebriefing = recorder.status === "debriefing";
  const isBusy = recorder.status === "requesting" || recorder.status === "stopping";

  // Inferred from the device and its motion, not asked. See detect-setting.ts.
  //
  // Sampling now runs on every page rather than only on `/record`, which is a
  // deliberate cost: the dock can start a drive from anywhere, so the setting
  // has to be inferable from anywhere — a participant who taps record while
  // reading the board still needs the right profile. It stops for the duration
  // of the recording, which is when the phone is actually in a cradle.
  const detected = useDetectedSetting({ enabled: !isRecording && !isDebriefing });
  const [chosenSetting, setChosenSetting] = useState<CaptureSetting | null>(null);

  /* A correction is remembered, not just applied.
   *
   * It used to last one visit, which is right for a one-off and wrong for a
   * seven-day study on a phone that may never grant the accelerometer: the
   * participant would correct the same wrong guess every morning, or stop
   * bothering and let the drive run under it. The detector reads this back as
   * `remembered`, and any live sensor reading still outranks it. */
  const chooseSetting = useCallback((next: CaptureSetting | null) => {
    setChosenSetting(next);
    if (next) rememberSetting(next);
  }, []);

  // Per-browser preferences, remembered across visits. See their stores.
  const [voiceId, chooseVoice] = useVoice();
  const [sttLanguage, chooseSttLanguage] = useSttLanguage();
  const [conditionOverride, toggleCondition] = useConditionOverride();

  // Armed with the recording, for the whole drive — there is no separate
  // gesture to enter it. Everything it does is downstream of the microphone
  // stream the recorder publishes, so capture is unaffected either way.
  const talkback = useTalkback({
    captureSessionId: recorder.currentSessionId,
    enabled: TALKBACK_ENABLED && isRecording,
  });

  const setting = chosenSetting ?? detected.setting;
  const source: SettingSource = chosenSetting ? "chosen" : detected.source;
  const settingUnknown = source === "default";

  const { requestMotion } = detected;
  const { start, stop, finishDebrief: endDebrief } = recorder;

  const startRecording = useCallback(() => {
    // iOS gates the accelerometer behind a tap; this is the tap. The answer
    // arrives for the next recording, and this one starts now.
    void requestMotion();
    // NOT WITH A GUESS NOBODY CONFIRMED. The caller shows the picker instead;
    // this is the backstop, so no other path can start a drive under a
    // setting that nothing observed. See `settingUnknown`.
    if (settingUnknown) return;
    // Read HERE rather than held in state: `takeUseCase` clears as it reads, so
    // the example belongs to this drive and not to every later one, and this
    // provider is mounted for the whole app — holding it would mean deciding
    // when to forget it, which is the same question with more moving parts.
    void start(setting, source, voiceId, sttLanguage,  conditionOverride);
  }, [
    requestMotion,
    settingUnknown,
    start,
    setting,
    source,
    voiceId,
    sttLanguage,
    conditionOverride,
  ]);

  const stopRecording = useCallback(() => {
    void stop();
  }, [stop]);

  const finishDebrief = useCallback(() => {
    void endDebrief();
  }, [endDebrief]);

  const value = useMemo<CaptureContextValue>(
    () => ({
      recorder,
      talkback,
      isRecording,
      isDebriefing,
      isBusy,
      setting,
      source,
      chosenSetting,
      chooseSetting,
      settingUnknown,
      conditionOverride,
      toggleCondition,
      voiceId,
      chooseVoice,
      sttLanguage,
      chooseSttLanguage,
      startRecording,
      stopRecording,
      finishDebrief,
    }),
    [
      recorder,
      talkback,
      isRecording,
      isDebriefing,
      isBusy,
      setting,
      source,
      chosenSetting,
      chooseSetting,
      settingUnknown,
      conditionOverride,
      toggleCondition,
      voiceId,
      chooseVoice,
      sttLanguage,
      chooseSttLanguage,
      startRecording,
      stopRecording,
      finishDebrief,
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

