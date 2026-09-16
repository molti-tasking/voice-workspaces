/**
 * The voices the system can speak with.
 *
 * A catalogue in code rather than a single env var, for the same reason the
 * setting profiles are: the choice has to be recoverable per recording months
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
 * safe to ship to the browser. Like `setting.ts`, this file is pure and free of
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
}

/**
 * Labels are placeholders until someone has listened to them: nothing here
 * can query ElevenLabs for the voices' own names. Rename freely — the id is the
 * identity, and `capture_session.voice_id` stores the id, never the label.
 */
export const VOICES: readonly VoiceProfile[] = [
  { id: "XHqlxleHbYnK8xmft8Vq", label: "Voice A", hint: "ElevenLabs XHql…" },
  { id: "x86DtpnPPuq2BpEiKPRy", label: "Voice B", hint: "ElevenLabs x86D…" },
  { id: "A9evEp8yGjv4c3WsIKuY", label: "Voice C", hint: "ElevenLabs A9ev…" },
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
 * The voice the rating probe speaks in — never the one the agent is using.
 *
 * WHY A DIFFERENT VOICE AT ALL. "Rate this" opens a channel that is about the
 * system rather than with it, and a driver cannot see a mode indicator. The
 * voice IS the indicator: while a second voice is asking, nothing being said
 * reaches the agent, the summary or the transcript's derived work. Saying that
 * in words, once, would be forgotten by the third drive; saying it in a voice
 * is heard every time and needs no attention to notice.
 *
 * Deterministic, so a participant hears ONE feedback voice for the whole study
 * — a channel that sounds different each time is a different channel. Taken
 * from the same catalogue rather than a fourth voice in an env var, for the
 * reason the catalogue exists: a voice that lives only in a deployment's
 * `.env` cannot be recovered from the data months later.
 *
 * The last entry is the designated one, and the first that differs is used
 * when the drive is already speaking in it — a rating voice equal to the
 * agent's would silently remove the signal.
 */
export function ratingVoiceIdFor(driveVoiceId: string | null | undefined): string {
  const drive = asVoiceId(driveVoiceId);
  const designated = VOICES[VOICES.length - 1]!.id;
  if (designated !== drive) return designated;
  return VOICES.find((v) => v.id !== drive)!.id;
}
