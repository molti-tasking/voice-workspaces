import type { SpeakResult } from "./speak";

/**
 * A voice that needs no provider.
 *
 * NOT a voice anyone should listen to — it is a formant-ish buzz with a syllable
 * envelope, recognisable as "speech-shaped" and nothing more. It exists because
 * the audio path has many places to go silently wrong (WAV header stripping,
 * binary framing over the socket, sample-rate declaration, the ring buffer,
 * consumed-sample accounting for barge-in) and none of them can be exercised
 * while every TTS provider is unavailable.
 *
 * The proxy's `/audio/speech` has been returning 500 for every model for days,
 * and there is no ElevenLabs key configured. Rather than ship an audio pipeline
 * that has never carried a sample, this makes the whole path testable today —
 * and when a real provider returns, the bytes travel the identical route.
 *
 * Enable with `TTS_PROVIDER=synthetic`. It is deliberately not a fallback: a
 * study must never accidentally record participants listening to this.
 */

const SAMPLE_RATE = 22_050;

/** Roughly the pace of speech, so timing behaves like the real thing. */
const MS_PER_CHARACTER = 60;

/**
 * Speech-shaped audio: a voiced fundamental with formant resonances and a
 * syllable-rate envelope. Same construction as the VAD test fixtures, so the
 * microphone tap treats it as speech — which is what makes it useful for
 * exercising echo cancellation and barge-in.
 */
function buzz(durationMs: number): Buffer {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE);
  const pcm = Buffer.alloc(samples * 2);
  const formants = [500, 1500, 2500];
  const fundamental = 120;

  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);
    let value = 0;

    for (let harmonic = 1; harmonic * fundamental < 3500; harmonic++) {
      const frequency = harmonic * fundamental;
      let gain = 0.15 / harmonic;
      for (const formant of formants) {
        gain += 0.9 / (1 + ((frequency - formant) / 120) ** 2) / harmonic ** 0.3;
      }
      value += gain * Math.sin(2 * Math.PI * frequency * t);
    }

    const sample = Math.max(-1, Math.min(1, value * envelope * 0.08));
    pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
  }

  return pcm;
}

export function speakSynthetic(text: string): SpeakResult {
  const pcm = buzz(Math.max(200, text.length * MS_PER_CHARACTER));

  // Delivered in chunks with realistic gaps, so the client's ring buffer, its
  // prebuffer threshold and its underrun handling are all genuinely exercised
  // rather than being handed one complete blob.
  const CHUNK = 4096;
  let offset = 0;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= pcm.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(pcm.subarray(offset, offset + CHUNK)));
      offset += CHUNK;
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
  });

  return {
    stream,
    requestedModel: "synthetic",
    resolvedModel: "synthetic",
    format: "pcm",
    sampleRate: SAMPLE_RATE,
    ttfbMs: 0,
  };
}
