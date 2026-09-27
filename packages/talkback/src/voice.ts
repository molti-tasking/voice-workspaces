/**
 * The voices the system can speak with.
 *
 * A catalogue in code rather than a single env var, for the same reason the
 * profile is: the choice has to be recoverable per recording months
 * later, and a value that lives only in a deployment's `.env` is not. The
 * recorder offers this list before a recording starts, the chosen id is stored
 * on `capture_session.voice_id`, and `/api/realtime/session` hands it to the
 * Pipecat container — which never chooses a voice itself.
 *
 * `ELEVENLABS_VOICE_ID` still exists and is still required by `bot.py`. It is
 * the FALLBACK: the voice used when a session carries no choice (recordings
 * made before this existed, or a degraded connection with no ticket). Set it to
 * one of the ids below so the fallback is a voice the study has heard.
 *
 * Voice ids are not secrets — they name public ElevenLabs voices — so they are
 * safe to ship to the browser. Like `profile.ts`, this file is pure and free of
 * any @voicemural/db import, and is exported as `@voicemural/talkback/voice`
 * so the recorder (a client component) can reach it without dragging the
 * Postgres driver into the bundle.
 */

export interface VoiceProfile {
  /** The ElevenLabs voice id. What `bot.py` hands to the TTS service. */
  id: string;
  /** What a participant sees on the picker. */
  label: string;
  /** One line under the label. */
  hint: string;
  /**
   * The language this voice is a NATIVE speaker of, as a catalogue code from
   * `language.ts`. ElevenLabs voices are multilingual, but a voice speaks every
   * language with the accent of the person it was cloned from: "USA Girl"
   * reading Danish sounds like an American reading Danish, and the pilots
   * heard exactly that. `voiceFor` uses this to swap in a native speaker.
   */
  language: string;
}

/**
 * One native speaker per non-English language — TO BE FILLED IN.
 *
 * Pick each from the ElevenLabs Voice Library (filter by language and accent,
 * e.g. "Danish / Copenhagen"), add it to the account's "My Voices", and paste
 * its id here. An empty id is left out of the catalogue entirely, so until a
 * language has one its drives keep the chosen English voice — now told which
 * language it is speaking (see `ttsLanguage` in /api/realtime/session), which
 * already fixes pronunciation of numbers and names, but not the accent.
 */
const NATIVE_VOICE_IDS: Record<string, { id: string; label: string }> = {
  de: { id: "", label: "Deutsch" },
  da: { id: "", label: "Dansk" },
  es: { id: "", label: "Español" },
};

function nativeVoices(): VoiceProfile[] {
  return Object.entries(NATIVE_VOICE_IDS)
    .filter(([, v]) => v.id.length > 0)
    .map(([language, v]) => ({
      id: v.id,
      label: v.label,
      hint: `Native ${v.label} voice`,
      language,
    }));
}

/**
 * Labels are placeholders until someone has listened to them: nothing here
 * can query ElevenLabs for the voices' own names. Rename freely — the id is the
 * identity, and `capture_session.voice_id` stores the id, never the label.
 */
export const VOICES: readonly VoiceProfile[] = [
  { id: "XHqlxleHbYnK8xmft8Vq", label: "Voice A", hint: "ElevenLabs XHql…", language: "en" },
  { id: "x86DtpnPPuq2BpEiKPRy", label: "Voice B", hint: "ElevenLabs x86D…", language: "en" },
  { id: "A9evEp8yGjv4c3WsIKuY", label: "Voice C", hint: "ElevenLabs A9ev…", language: "en" },
  ...nativeVoices(),
];

export const VOICE_IDS: readonly string[] = VOICES.map((v) => v.id);

/** Offered first on the picker and used when a browser has nothing stored. */
export const DEFAULT_VOICE_ID: string = VOICES[0]!.id;

/** Whether an untrusted string names a voice in the catalogue. */
export function isKnownVoice(value: string | null | undefined): value is string {
  return typeof value === "string" && VOICE_IDS.includes(value);
}

/**
 * Narrow an untrusted string to a catalogue id, or null.
 *
 * Null rather than the default on purpose: a stored null means "no choice was
 * made, use the deployment's fallback voice", and that is a different fact from
 * "chose Voice A" — the study should be able to tell them apart.
 */
export function asVoiceId(value: string | null | undefined): string | null {
  return isKnownVoice(value) ? value : null;
}

export function voiceProfile(id: string | null | undefined): VoiceProfile | null {
  return VOICES.find((v) => v.id === id) ?? null;
}

/**
 * The voice a drive should speak with in `language`.
 *
 * The chosen voice when it is a native speaker of that language — or when
 * the catalogue has no native speaker for it, since a known voice with an
 * accent beats a silent swap to nothing. Otherwise the language's native
 * voice. Null language (auto-detect, nothing heard yet) keeps the choice.
 *
 * Mirrored by `LanguageFollower` in bot.py, which applies the same rule
 * mid-drive from the map `nativeVoicesByLanguage` hands it.
 */
export function voiceFor(language: string | null | undefined, chosen: string | null): string | null {
  if (!language) return chosen;
  const current = voiceProfile(chosen);
  if (current?.language === language) return chosen;
  return nativeVoicesByLanguage()[language] ?? chosen;
}

/** Language code -> the native voice id, for languages that have one. */
export function nativeVoicesByLanguage(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of VOICES) {
    if (v.language !== "en" && !(v.language in out)) out[v.language] = v.id;
  }
  return out;
}

/**
 * What the picker offers once a language is pinned: the native speakers of
 * it first, then the rest. Auto (null) offers everything, in catalogue order.
 */
export function voicesForPicker(language: string | null): VoiceProfile[] {
  if (!language) return [...VOICES];
  const native = VOICES.filter((v) => v.language === language);
  const other = VOICES.filter((v) => v.language !== language && v.language === "en");
  return [...native, ...other];
}
