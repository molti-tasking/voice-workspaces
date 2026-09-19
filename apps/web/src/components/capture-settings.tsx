"use client";

// The `/…` subpaths, NOT the package index: the index re-exports retrieval.ts,
// which imports @voicemural/db, and that drags the Postgres driver into the
// browser bundle. These three modules are pure by construction.
import { STT_LANGUAGES } from "@voicemural/talkback/language";
import { SETTINGS, SETTING_PROFILES } from "@voicemural/talkback/setting";
import { VOICES } from "@voicemural/talkback/voice";
import {
  STUDY_TOGGLES_ENABLED,
  TOGGLEABLE,
} from "@/lib/recorder/condition-store";
import { TALKBACK_ENABLED, useCapture } from "./capture-provider";

/**
 * The three choices a drive is fixed at.
 *
 * Extracted out of the recorder screen because the dock's record button now
 * offers the same choices from any page, and two copies of a picker whose
 * values are immutable-per-session is exactly the kind of drift that produces
 * a recording nobody can interpret. One implementation, one source of truth,
 * read straight off the capture context.
 *
 * All three are PRE-RECORDING ONLY, and that is a data constraint rather than
 * a UI preference: `capture_session.setting` and `voiceId` are fixed at insert
 * (see `api/capture-sessions/route.ts`), and a drive whose second half ran
 * under different rules — different turn-taking, a different voice, a
 * different transcription language — is not interpretable under either. The
 * pickers disable themselves while a recording is running; `LockedSummary`
 * says what it is running under instead.
 */

/**
 * The correction, for when the detector is wrong.
 *
 * Hidden by default on `/record`: the setting is read off the device and its
 * motion, and asking anyway would make choosing a mode the first task of every
 * recording — a task, for someone whose hands are on something else.
 *
 * Four options, one row, no icons: the labels are shorter to read than any
 * pictogram is to decode.
 */
export function SettingPicker() {
  const { setting, chosenSetting, chooseSetting, isBusy, isRecording } = useCapture();

  return (
    <fieldset
      className="flex w-full max-w-md flex-wrap justify-center gap-1.5"
      disabled={isBusy || isRecording}
    >
      <legend className="sr-only">Where are you?</legend>
      {SETTINGS.map((option) => {
        const active = option === setting;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => chooseSetting(option)}
            className={[
              "cursor-pointer rounded-full px-3.5 py-1.5 text-sm transition-colors disabled:cursor-default disabled:opacity-50",
              active
                ? "bg-white/12 text-white ring-1 ring-white/25"
                : "text-white/40 hover:text-white/70",
            ].join(" ")}
          >
            {SETTING_PROFILES[option].label}
          </button>
        );
      })}
      {chosenSetting !== null && !isRecording && (
        // A correction holds for this visit only — the next recording is
        // detected afresh, because the situation is what changed, not the
        // person's mind. This is how you get back to that.
        <button
          type="button"
          onClick={() => chooseSetting(null)}
          className="cursor-pointer rounded-full px-3 py-1.5 text-sm text-white/30 underline-offset-4 hover:text-white/60 hover:underline"
        >
          auto
        </button>
      )}
    </fieldset>
  );
}

/**
 * Which voice talks back, asked alongside the setting.
 *
 * Smaller and dimmer than the setting row because it is the less consequential
 * choice — it changes how the system sounds, not how it behaves — and the last
 * thing between opening the app and starting to think should stay one row of
 * four words.
 *
 * Renders nothing without talk-back in the bundle, but the choice is still
 * sent: a session recorded before talk-back was enabled for it carries the
 * voice it would have had.
 */
export function VoicePicker() {
  const { voiceId, chooseVoice, isBusy, isRecording } = useCapture();
  if (!TALKBACK_ENABLED) return null;

  return (
    <fieldset
      className="flex w-full max-w-md flex-wrap items-center justify-center gap-1.5 text-xs"
      disabled={isBusy || isRecording}
    >
      <legend className="sr-only">Which voice?</legend>
      <span className="mr-1 text-white/30">Voice</span>
      {VOICES.map((voice) => {
        const active = voice.id === voiceId;
        return (
          <button
            key={voice.id}
            type="button"
            aria-pressed={active}
            title={voice.hint}
            onClick={() => chooseVoice(voice.id)}
            className={[
              "cursor-pointer rounded-full px-3 py-1 transition-colors disabled:cursor-default disabled:opacity-50",
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
 * Which language the drive is transcribed in, asked alongside the voice.
 *
 * Auto first and selected by default, because the corpus is mixed
 * German/English and detection handles code-switching; a fixed code is the
 * exception — worth it on a monolingual German drive, where Whisper detection
 * on a short chunk can misfire into English.
 *
 * Consequential in a way the voice is not: it changes what the transcript
 * CONTAINS, not just how the system sounds, which is also why it is offered
 * without talk-back. Same dimmed row treatment — one glance, one tap, and the
 * labels are endonyms so the person they describe can read them.
 */
export function LanguagePicker() {
  const { sttLanguage, chooseSttLanguage, isBusy, isRecording } = useCapture();
  const auto = sttLanguage === null;

  return (
    <fieldset
      className="flex w-full max-w-md flex-wrap items-center justify-center gap-1.5 text-xs"
      disabled={isBusy || isRecording}
    >
      <legend className="sr-only">Which language?</legend>
      <span className="mr-1 text-white/30">Language</span>
      <button
        type="button"
        aria-pressed={auto}
        title="Detect per utterance — right for mixed German/English"
        onClick={() => chooseSttLanguage(null)}
        className={[
          "cursor-pointer rounded-full px-3 py-1 transition-colors disabled:cursor-default disabled:opacity-50",
          auto
            ? "bg-white/12 text-white ring-1 ring-white/25"
            : "text-white/40 hover:text-white/70",
        ].join(" ")}
      >
        Auto
      </button>
      {STT_LANGUAGES.map((language) => {
        const active = language.code === sttLanguage;
        return (
          <button
            key={language.code}
            type="button"
            aria-pressed={active}
            title={language.hint}
            onClick={() => chooseSttLanguage(language.code)}
            className={[
              "cursor-pointer rounded-full px-3 py-1 transition-colors disabled:cursor-default disabled:opacity-50",
              active
                ? "bg-white/12 text-white ring-1 ring-white/25"
                : "text-white/40 hover:text-white/70",
            ].join(" ")}
          >
            {language.label}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * What the running drive is fixed at, stated rather than offered.
 *
 * Shown in place of the pickers once recording has started. G16 — convey the
 * consequences of user actions — applies in reverse here: the reason the
 * controls are inert has to be visible, or a participant reads a greyed-out
 * row as a bug and taps it for the rest of the drive.
 */
export function LockedSummary() {
  const { setting, voiceId, sttLanguage } = useCapture();
  const voice = VOICES.find((v) => v.id === voiceId);
  const language =
    sttLanguage === null
      ? "Auto"
      : (STT_LANGUAGES.find((l) => l.code === sttLanguage)?.label ?? sttLanguage);

  return (
    <dl className="grid w-full max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      <dt className="text-white/30">Setting</dt>
      <dd className="text-white/70">{SETTING_PROFILES[setting].label}</dd>
      {TALKBACK_ENABLED && (
        <>
          <dt className="text-white/30">Voice</dt>
          <dd className="text-white/70">{voice?.label ?? "Default"}</dd>
        </>
      )}
      <dt className="text-white/30">Language</dt>
      <dd className="text-white/70">{language}</dd>
    </dl>
  );
}

/**
 * The study arm for THIS drive. Pilot builds only.
 *
 * The next pilot is a cold-start test — the same person, two drives an hour
 * apart, agenda offers on in one and off in the other — and the condition is
 * otherwise a property of the participant, copied onto each drive at insert.
 * Flipping it between two drives in an afternoon meant a database write with
 * the researcher sitting in a car.
 *
 * TWO SWITCHES, BOTH OFF FOR PARTICIPANTS. This renders only in a bundle built
 * with `NEXT_PUBLIC_STUDY_TOGGLES`, and the server honours an override only
 * for accounts in `STUDY_PILOT_USER_IDS`. A participant who could flip their
 * own arm is a participant whose phase cannot be analysed.
 *
 * Three states per flag, not two: `on`, `off` and `—`. "Not overridden" and
 * "overridden to off" are different instructions, and collapsing them would
 * make every drive carry an override whether or not anyone chose one.
 */
export function ConditionToggles() {
  const { conditionOverride, toggleCondition, isBusy, isRecording } = useCapture();
  if (!STUDY_TOGGLES_ENABLED) return null;

  return (
    <div className="w-full max-w-md space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-medium text-amber-100/80">
        Study arm for this drive — pilot accounts only
      </p>
      {TOGGLEABLE.map((flag) => {
        const value = conditionOverride[flag];
        return (
          <fieldset
            key={flag}
            className="flex items-center justify-between gap-3"
            disabled={isBusy || isRecording}
          >
            <legend className="sr-only">{flag}</legend>
            <span className="font-mono text-xs text-white/50">{flag}</span>
            <div className="flex gap-1">
              {(
                [
                  ["—", null],
                  ["off", false],
                  ["on", true],
                ] as const
              ).map(([label, next]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={value === next || (next === null && value === undefined)}
                  onClick={() => toggleCondition(flag, next)}
                  className={[
                    "cursor-pointer rounded px-2 py-1 text-xs transition-colors disabled:opacity-50",
                    (next === null && value === undefined) || value === next
                      ? "bg-white/15 text-white"
                      : "text-white/40 hover:text-white/70",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        );
      })}
      <p className="text-xs text-white/30">
        &ldquo;—&rdquo; leaves the participant&rsquo;s own condition in place.
      </p>
    </div>
  );
}
