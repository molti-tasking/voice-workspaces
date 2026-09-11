/**
 * The languages a drive can be transcribed in.
 *
 * A catalogue in code rather than the STT_LANGUAGE env var, for the same
 * reason the voices are: the choice has to be recoverable per recording
 * months later, and a value that lives only in a deployment's `.env` is not.
 * The recorder offers this list before a recording starts, the chosen code is
 * stored on `capture_session.stt_language`, and BOTH transcription paths read
 * it: the live STT in `bot.py` (handed over by `/api/realtime/session`) and
 * the ledger Whisper in `apps/worker`.
 *
 * NULL — no choice — means auto-detect, which stays the default because the
 * corpus is deliberately mixed German/English: a fixed Deepgram language does
 * not merely mishear other languages, it returns NOTHING for them. Forcing
 * `de` is still worth offering because detection on a short VAD-cut utterance
 * can misfire on a monolingual drive.
 *
 * `STT_LANGUAGE` still exists and is still read by `bot.py`. It is the
 * FALLBACK for a session that carries no choice — recordings made before this
 * picker existed, or a degraded connection with no ticket.
 *
 * Like `voice.ts`, this file is pure and free of any @voicemural/db import,
 * and is exported as `@voicemural/talkback/language` so the recorder (a client
 * component) can reach it without dragging the Postgres driver into the
 * bundle.
 */

export interface SttLanguageProfile {
  /** The BCP-47 tag handed to the ASR provider. What gets stored, never the label. */
  code: string;
  /** What a participant sees on the picker. */
  label: string;
  /** One line under the label. */
  hint: string;
}

/**
 * Endonyms on purpose: the person picking "Deutsch" is reading German, and a
 * language named in a language they may not read is not a choice.
 */
export const STT_LANGUAGES: readonly SttLanguageProfile[] = [
  { code: "en", label: "English", hint: "Transcribe English only" },
  { code: "de", label: "Deutsch", hint: "Transcribe German only" },
];

export const STT_LANGUAGE_CODES: readonly string[] = STT_LANGUAGES.map((l) => l.code);

/** Whether an untrusted string names a language in the catalogue. */
export function isKnownSttLanguage(value: string | null | undefined): value is string {
  return typeof value === "string" && STT_LANGUAGE_CODES.includes(value);
}

/**
 * Narrow an untrusted string to a catalogue code, or null.
 *
 * Null means AUTO-DETECT, not "the deployment default" — a different fact from
 * having chosen a language, and the study should be able to tell them apart.
 */
export function asSttLanguage(value: string | null | undefined): string | null {
  return isKnownSttLanguage(value) ? value : null;
}

export function sttLanguageProfile(code: string | null | undefined): SttLanguageProfile | null {
  return STT_LANGUAGES.find((l) => l.code === code) ?? null;
}
