#!/usr/bin/env node
/**
 * Phase 0 spike for realtime talk-back. Throwaway measurement, not a test.
 *
 * The talk-back design rests on four numbers that no amount of reading can
 * supply, because they are properties of *this* LiteLLM deployment rather than
 * of the code:
 *
 *   1. Does /audio/speech exist, and does its body actually STREAM? If LiteLLM
 *      buffers the whole synthesis before sending headers, then time-to-first-
 *      audio is full synthesis time (1-3s, growing with reply length) rather
 *      than TTFB (150-600ms, flat). That single fact moves the perceived
 *      latency budget by seconds and makes sentence-pipelining mandatory rather
 *      than an optimisation.
 *   2. How long faster-whisper takes on 3s / 5s / 10s of speech, warm — and how
 *      much worse it gets while the chunk pipeline is hammering the same GPU at
 *      its usual batchSize of 4. That gap is the whole justification for a
 *      separate MODEL_TRANSCRIBE_LIVE role.
 *   3. Whether the conversation model streams, accepts `tools`, and accepts
 *      `stream_options.include_usage` — and what its TTFT is. gemma3:12b very
 *      likely cannot call tools at all, which decides whether MODEL_CONVERSE
 *      can be a self-hosted model or has to be a hosted one.
 *   4. What all of that adds up to end to end.
 *
 * Deliverable is the table this prints. Run it before writing any of Phase 1:
 *
 *     node scripts/spike-talkback.mjs
 *     node scripts/spike-talkback.mjs --runs 5 --contention 4
 *
 * Two questions in the spike plan are NOT answerable here, because they are
 * properties of a browser in a car and of the production proxy:
 *
 *   - Bluetooth: does pairing to the car flip the mic to HFP narrowband when
 *     TTS plays, degrading the verbatim ledger? Measure in the browser with
 *     `stream.getAudioTracks()[0].getSettings()` before and during playback,
 *     in the actual car. With talk-back always on this affects EVERY drive.
 *   - Does a WebSocket survive Coolify's Traefik, including 10 minutes idle?
 *     Measure against the deployment once apps/realtime exists.
 */
import { parseArgs } from "node:util";
import { c, fail, readEnv } from "./preflight.mjs";

const { values: argv } = parseArgs({
  options: {
    runs: { type: "string", default: "3" },
    contention: { type: "string", default: "4" },
    "skip-contention": { type: "boolean", default: false },
  },
});

const RUNS = Number(argv.runs);
const CONTENTION = Number(argv.contention);

const env = { ...readEnv(), ...process.env };
const BASE_URL = (env.LITELLM_BASE_URL ?? "").replace(/\/+$/, "");
const API_KEY = env.LITELLM_API_KEY;

if (!BASE_URL || !API_KEY) {
  fail(
    "LITELLM_BASE_URL and LITELLM_API_KEY must be set",
    "This spike measures a real LiteLLM deployment — there is nothing to mock.",
    "",
    "If this host needs the university VPN, connect first.",
  );
}

/**
 * Roles this spike probes. MODEL_CONVERSE / MODEL_SPEAK / MODEL_EMBED /
 * MODEL_TRANSCRIBE_LIVE do not exist in .env yet — that is the point. Fall back
 * to the nearest existing role so the spike still produces numbers, and say
 * plainly which value was used.
 */
const MODELS = {
  transcribe: env.MODEL_TRANSCRIBE,
  transcribeLive: env.MODEL_TRANSCRIBE_LIVE ?? env.MODEL_TRANSCRIBE,
  converse: env.MODEL_CONVERSE ?? env.MODEL_FAST,
  speak: env.MODEL_SPEAK,
  embed: env.MODEL_EMBED,
};
const VOICE = env.SPEAK_VOICE ?? "alloy";

const auth = { Authorization: `Bearer ${API_KEY}` };
const json = { ...auth, "Content-Type": "application/json" };

const heading = (s) => console.log(`\n${c.bold(s)}\n${"─".repeat(s.length)}`);
const row = (k, v, note = "") =>
  console.log(`  ${k.padEnd(30)} ${String(v).padStart(10)}  ${c.dim(note)}`);
const ms = (n) => (n === undefined || n === null ? "—" : `${Math.round(n)}ms`);

/** p50/p95 without pulling in a stats dependency. */
function pct(values, p) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
const summarise = (values) =>
  values.length
    ? `p50 ${ms(pct(values, 50))}  p95 ${ms(pct(values, 95))}  n=${values.length}`
    : "no successful runs";

/* --------------------------------------------------------------------------
 * Minimal PCM16 mono WAV codec.
 *
 * The realtime path assembles WAVs in memory exactly this way (44-byte header +
 * Int16 samples, no encoder, no container muxer, no native dependency), so
 * using the same construction here means the spike measures what production
 * will actually send.
 * ------------------------------------------------------------------------ */

function encodeWav(samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // format = PCM
  buf.writeUInt16LE(1, 22); // channels = mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

/** Walk the chunk list rather than assuming data starts at byte 44 — some TTS
 *  backends emit a LIST/INFO chunk first, and a fixed offset would silently
 *  treat metadata as audio. */
function decodeWav(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF") return null;
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  const channels = buf.readUInt16LE(22);
  if (bitsPerSample !== 16) return null;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      const count = Math.floor(Math.min(size, buf.length - offset - 8) / 2);
      const all = new Int16Array(count);
      for (let i = 0; i < count; i++) all[i] = buf.readInt16LE(offset + 8 + i * 2);
      // Downmix to mono by taking the left channel; the live tap is mono.
      if (channels === 1) return { samples: all, sampleRate };
      const mono = new Int16Array(Math.floor(count / channels));
      for (let i = 0; i < mono.length; i++) mono[i] = all[i * channels];
      return { samples: mono, sampleRate };
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  return null;
}

/** Repeat/trim speech to an exact duration. Whisper latency tracks audio
 *  length, so the clips must be exactly 3s / 5s / 10s to be comparable. */
function clipTo(samples, sampleRate, seconds) {
  const target = Math.round(sampleRate * seconds);
  const out = new Int16Array(target);
  if (samples.length === 0) return out;
  for (let i = 0; i < target; i++) out[i] = samples[i % samples.length];
  return out;
}

/** Fallback when TTS is unavailable: speech-shaped noise. Whisper will
 *  hallucinate words, but the DURATION is what drives latency, and that is what
 *  this measures. Flagged in the output so the numbers are not over-read. */
function syntheticSpeech(sampleRate, seconds) {
  const n = Math.round(sampleRate * seconds);
  const out = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    // Wandering formant plus an amplitude envelope at syllable rate (~4 Hz).
    const f0 = 110 + 40 * Math.sin(2 * Math.PI * 0.7 * t);
    phase += (2 * Math.PI * f0) / sampleRate;
    const env = 0.35 + 0.35 * Math.sin(2 * Math.PI * 4 * t);
    const harmonics = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(harmonics * env * 9000)));
  }
  return out;
}

/* --------------------------------------------------------------------------
 * 1. /audio/speech — existence, formats, and the streaming question
 * ------------------------------------------------------------------------ */

/**
 * The measurement that matters is the gap between headers and the LAST byte.
 *
 * If the backend streams, headers arrive early and bytes trickle in, so
 * firstByte is far below total. If LiteLLM buffers, everything lands at once
 * and firstByte ≈ total — which means time-to-first-audio grows with reply
 * length and sentence-pipelining stops being optional.
 */
async function measureSpeak(model, text, format) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(`${BASE_URL}/audio/speech`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ model, input: text, voice: VOICE, response_format: format }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const headersMs = performance.now() - started;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: (await res.text()).slice(0, 300),
      headersMs,
    };
  }

  const reader = res.body.getReader();
  const parts = [];
  let firstByteMs;
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs === undefined) firstByteMs = performance.now() - started;
    parts.push(Buffer.from(value));
    bytes += value.length;
  }
  const totalMs = performance.now() - started;

  return {
    ok: true,
    headersMs,
    firstByteMs,
    totalMs,
    bytes,
    contentType: res.headers.get("content-type") ?? undefined,
    body: Buffer.concat(parts),
    // If the first byte lands in the last 20% of the request, nothing streamed.
    streamed: firstByteMs !== undefined && firstByteMs < totalMs * 0.8,
  };
}

async function probeSpeak() {
  heading("1. TTS  —  /audio/speech");

  if (!MODELS.speak) {
    console.log(
      `  ${c.yellow("MODEL_SPEAK is not set.")} Set it in .env to a TTS model on this proxy.`,
    );
    console.log(`  ${c.dim("Candidates from /models are listed at the end of this run.")}`);
    return null;
  }
  row("model", MODELS.speak);

  const short = "Right, so what were you saying about the deadline?";
  const long =
    "Right, so what were you saying about the deadline? " +
    "I think the point you made earlier about scope is the one that actually matters here, " +
    "and it might be worth writing that down before it gets away from you. " +
    "There were three separate things tangled together in what you just said.";

  const results = {};
  for (const format of ["pcm", "wav", "mp3"]) {
    const r = await measureSpeak(MODELS.speak, short, format);
    if (!r.ok) {
      row(`format ${format}`, "unsupported", `${r.status ?? ""} ${(r.error ?? "").slice(0, 80)}`);
      continue;
    }
    results[format] = r;
    row(
      `format ${format}`,
      `${(r.bytes / 1024).toFixed(0)}KB`,
      `headers ${ms(r.headersMs)} · first byte ${ms(r.firstByteMs)} · total ${ms(r.totalMs)}` +
        ` · ${r.contentType ?? "?"}`,
    );
  }

  /* Content-Type is not to be trusted here.
   *
   * This proxy answers `audio/mpeg` whatever response_format was asked for,
   * while the BYTES honour the request (a 3s pcm reply is ~144KB = 24000 * 2 * 3,
   * an mp3 of the same is ~46KB). So the playback path must decode according to
   * what it REQUESTED, never according to the header — trusting the header would
   * hand mp3-framed bytes to a PCM ring buffer and produce noise. */
  const byteSizes = Object.entries(results).map(([f, r]) => `${f} ${(r.bytes / 1024).toFixed(0)}KB`);
  const contentTypes = new Set(Object.values(results).map((r) => r.contentType));
  if (contentTypes.size === 1 && Object.keys(results).length > 1) {
    console.log(
      `  ${c.yellow("⚠ Content-Type is")} ${[...contentTypes][0]} ${c.yellow("for every format")}, but the bytes differ\n` +
        `    (${byteSizes.join(", ")}). ${c.bold("Decode by what you requested, never by the header.")}`,
    );
  }

  // Prefer wav: it self-describes its sample rate, so the client knows how many
  // samples it consumed (which barge-in truncation in §6 depends on) without
  // hardcoding a rate the backend might change.
  const chosen = results.wav ? "wav" : results.pcm ? "pcm" : Object.keys(results)[0];
  const best = chosen ? { format: chosen, ...results[chosen] } : null;

  if (!best) {
    console.log(`\n  ${c.red("No audio format worked.")} Talk-back cannot speak on this proxy.`);
    return null;
  }

  // The verdict. Compare a short and a long input: if total time scales with
  // input length while first-byte does not, it streams.
  const longRes = await measureSpeak(MODELS.speak, long, best.format);
  console.log("");
  row("chosen format", best.format);
  if (longRes.ok) {
    row(
      "short input",
      ms(best.firstByteMs),
      `first byte · total ${ms(best.totalMs)} · ${short.length} chars`,
    );
    row(
      "long input",
      ms(longRes.firstByteMs),
      `first byte · total ${ms(longRes.totalMs)} · ${long.length} chars`,
    );

    const streams = best.streamed && longRes.streamed;
    console.log("");

    /* Split first-byte latency into fixed and per-character cost.
     *
     * This is the distinction that decides what to DO about a slow TTS, and it
     * is not the same question as whether the body streams:
     *
     *   - Cost mostly PER CHARACTER → sentence-pipelining fixes it. Synthesise
     *     sentence 1 alone and it returns quickly, while sentence 2 generates.
     *   - Cost mostly FIXED per request → sentence-pipelining does NOT fix it.
     *     A four-word first sentence still pays the full overhead, so
     *     time-to-first-audio is stuck. Only a lower-latency TTS deployment, or
     *     a pre-synthesised backchannel covering the gap, moves it. */
    const perChar = (longRes.firstByteMs - best.firstByteMs) / (long.length - short.length);
    const fixed = best.firstByteMs - perChar * short.length;
    best.fixedMs = fixed;
    best.perCharMs = perChar;
    /* What the FIRST chunk would cost under clause-level pipelining — a ~30
     * character opening clause. This, not the whole-sentence number, is what
     * the user actually waits for once the reply is chunked, so it is what the
     * budget below should use. */
    best.clauseTtfbMs = Math.max(fixed, fixed + perChar * 30);
    row("fixed overhead per request", ms(fixed), "paid however short the sentence");
    row("marginal cost per char", `${perChar.toFixed(1)}ms`, `~${ms(perChar * 40)} for a short sentence`);

    console.log("");
    if (streams) {
      console.log(
        `  ${c.green("✓ STREAMS.")} Audio arrives progressively, so playback can start before\n` +
          `    synthesis finishes. Budget ${ms(longRes.firstByteMs)} for TTS TTFB.`,
      );
    } else {
      console.log(
        `  ${c.red("✗ BUFFERS.")} The whole synthesis lands at once — headers, first byte and\n` +
          `    last byte all arrive together (${ms(best.headersMs)} / ${ms(best.firstByteMs)} / ${ms(best.totalMs)}).`,
      );
    }

    if (fixed > 800) {
      console.log(
        `\n  ${c.red(`✗ ${ms(fixed)} OF FIXED OVERHEAD.`)} ${c.bold("Sentence-pipelining will not save this")} —\n` +
          `    a four-word first sentence pays the same ${ms(fixed)} as a long one, so\n` +
          `    time-to-first-audio cannot go below it. Two things that do work:\n\n` +
          `    ${c.bold("1. Deploy a low-latency self-hosted TTS")} (kokoro-82m, piper: 80-250ms TTFB).\n` +
          `       Highest-value infrastructure ask by a wide margin, and it also keeps\n` +
          `       participant speech on university hardware — see below.\n` +
          `    ${c.bold("2. Pre-synthesised backchannels")} ("mm", "right") cached on the client and\n` +
          `       played the instant the user stops. Perceived gap → ~0 while the real\n` +
          `       reply synthesises behind it. Not a hack: it is a turn-taking signal,\n` +
          `       and which one is used is exactly what persona should govern.`,
      );
    } else if (perChar > 0) {
      /* Almost no fixed cost means time-to-first-audio is a CHOICE: it is set by
       * how much text goes into the first request, not by the backend. Say what
       * that first chunk has to be to hit a target, because "split on sentences"
       * is not specific enough — a 90-character sentence still misses. */
      const target = 300;
      const chars = Math.floor(target / perChar);
      console.log(
        `\n  ${c.green("✓ NEARLY ALL MARGINAL COST")} (${ms(fixed)} fixed). Time-to-first-audio is set by how\n` +
          `    much text you send first, not by the backend — so chunking controls it directly.\n\n` +
          `    ${c.bold(`Send the first ~${chars} characters`)} (a clause, not a sentence) to speak within\n` +
          `    ~${ms(target)}, then pipeline the rest behind it while it plays. Split on clause\n` +
          `    boundaries — comma, dash, colon — not just on sentence-final punctuation.`,
      );
      if (!streams) {
        console.log(
          `    ${c.dim("The body does not stream, but with no fixed overhead that barely matters:")}\n` +
            `    ${c.dim("a small first chunk returns quickly regardless.")}`,
        );
      }
    }

    // .env.example is explicit that keeping recordings of people thinking aloud
    // on university infrastructure is worth preserving once the field study has
    // participants. A hosted TTS breaks that for the agent's half of the dialogue.
    if (/^(openai|azure|elevenlabs|deepgram)\//.test(MODELS.speak) || MODELS.speak === "tts-1") {
      console.log(
        `\n  ${c.yellow("⚠ This is a HOSTED model.")} Every agent reply — which quotes the participant\n` +
          `    back to them — would leave AU infrastructure. That contradicts the stance in\n` +
          `    .env.example and is an ethics-form line item. A self-hosted TTS fixes the\n` +
          `    latency and the privacy problem at the same time.`,
      );
    }
  }

  return best;
}

/* --------------------------------------------------------------------------
 * 2. Whisper latency, warm and under contention
 * ------------------------------------------------------------------------ */

async function transcribeOnce(model, wav, filename = "clip.wav") {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), filename);
  form.append("model", model);
  form.append("response_format", "json");

  const started = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: auth,
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    const latencyMs = performance.now() - started;
    if (!res.ok) {
      return { ok: false, latencyMs, status: res.status, error: (await res.text()).slice(0, 200) };
    }
    const body = await res.json();
    return { ok: true, latencyMs, text: (body.text ?? "").trim() };
  } catch (err) {
    return {
      ok: false,
      latencyMs: performance.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeTranscribe(speechSource) {
  heading("2. ASR  —  /audio/transcriptions");

  if (!MODELS.transcribeLive) {
    console.log(`  ${c.yellow("MODEL_TRANSCRIBE is not set.")} Skipping.`);
    return null;
  }
  row("model", MODELS.transcribeLive, MODELS.transcribeLive === MODELS.transcribe ? "(= MODEL_TRANSCRIBE)" : "");
  row("audio source", speechSource.kind, speechSource.note);

  const SAMPLE_RATE = 16_000;
  const clips = {};
  for (const seconds of [3, 5, 10]) {
    clips[seconds] = encodeWav(
      speechSource.samples
        ? clipTo(speechSource.samples, SAMPLE_RATE, seconds)
        : syntheticSpeech(SAMPLE_RATE, seconds),
      SAMPLE_RATE,
    );
  }

  // Cold start is a real cost on idle self-hosted models (.env.example warns of
  // 30-60s) and it would otherwise poison the first sample of the p50.
  console.log("");
  const cold = await transcribeOnce(MODELS.transcribeLive, clips[5]);
  row("cold start (5s clip)", ms(cold.latencyMs), cold.ok ? "" : c.red(cold.error ?? ""));
  if (!cold.ok) {
    console.log(`  ${c.red("Transcription failed — remaining ASR measurements skipped.")}`);
    return null;
  }
  if (cold.text) console.log(`  ${c.dim(`heard: "${cold.text.slice(0, 70)}"`)}`);

  const warm = {};
  console.log("");
  for (const seconds of [3, 5, 10]) {
    const latencies = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await transcribeOnce(MODELS.transcribeLive, clips[seconds]);
      if (r.ok) latencies.push(r.latencyMs);
    }
    warm[seconds] = latencies;
    const rtf = pct(latencies, 50) ? (pct(latencies, 50) / (seconds * 1000)).toFixed(3) : "—";
    row(`warm, ${seconds}s clip`, ms(pct(latencies, 50)), `${summarise(latencies)} · RTF ${rtf}`);
  }

  /* Fixed overhead vs per-second cost.
   *
   * If 3s and 10s clips take about the same wall-clock time, transcription is
   * not the bottleneck — proxy hops, queueing and model invocation overhead are,
   * and they are paid per REQUEST rather than per second of audio. That inverts
   * the usual advice: shortening utterances buys nothing, so `maxUtteranceMs`
   * can stay generous, and the only levers on this stage are starting the
   * request earlier (speculative ASR) or a lighter-weight deployment. */
  const p3 = pct(warm[3] ?? [], 50);
  const p10 = pct(warm[10] ?? [], 50);
  if (p3 && p10) {
    const perSecond = (p10 - p3) / 7;
    const fixed = p3 - perSecond * 3;
    console.log("");
    row("fixed overhead per request", ms(fixed), "paid regardless of utterance length");
    row("marginal cost per second", ms(perSecond), "the part that scales with audio");
    if (fixed > perSecond * 10) {
      console.log(
        `  ${c.yellow("→ Request overhead dominates.")} Shorter utterances will NOT be faster, so\n` +
          `    speculative ASR start (fire at 250ms of silence) is the only real lever here,\n` +
          `    and maxUtteranceMs can stay generous.`,
      );
    }
  }

  if (argv["skip-contention"]) return { warm };

  /* The contention measurement — the justification for MODEL_TRANSCRIBE_LIVE.
   *
   * apps/worker runs transcribe.chunk at batchSize 4, and during a talk-back
   * drive a 10s chunk arrives every 10s, continuously. So the live path is
   * never talking to an idle GPU. This reproduces that: fire `--contention`
   * background 10s transcriptions (what the chunk pipeline sends) and measure a
   * 5s live turn in the middle of them. */
  console.log("");
  console.log(
    `  ${c.dim(`Contention: ${CONTENTION} background 10s jobs (the chunk pipeline) + one 5s live turn`)}`,
  );

  const contended = [];
  for (let i = 0; i < RUNS; i++) {
    const background = Array.from({ length: CONTENTION }, () =>
      transcribeOnce(MODELS.transcribeLive, clips[10], "chunk.wav"),
    );
    // Let the background jobs actually reach the GPU before timing the live one.
    await new Promise((r) => setTimeout(r, 150));
    const live = await transcribeOnce(MODELS.transcribeLive, clips[5]);
    if (live.ok) contended.push(live.latencyMs);
    await Promise.allSettled(background);
  }

  const warmP50 = pct(warm[5], 50);
  const contendedP50 = pct(contended, 50);
  row("5s turn under load", ms(contendedP50), summarise(contended));

  console.log("");
  if (warmP50 && contendedP50) {
    const penalty = contendedP50 - warmP50;
    if (penalty > 400) {
      console.log(
        `  ${c.red(`✗ CONTENTION COSTS ${ms(penalty)}`)} (${ms(warmP50)} idle → ${ms(contendedP50)} loaded).\n` +
          `    A live turn queues behind the chunk pipeline and the feature feels\n` +
          `    intermittently broken, with no visible cause.\n` +
          `    ${c.bold("Point MODEL_TRANSCRIBE_LIVE at a distil/small deployment with its own queue.")}`,
      );
    } else {
      console.log(
        `  ${c.green(`✓ Contention costs only ${ms(penalty)}.`)} MODEL_TRANSCRIBE_LIVE can default to\n` +
          `    MODEL_TRANSCRIBE for now — but re-measure with a real drive's chunk rate.`,
      );
    }
  }

  return { warm, contended };
}

/* --------------------------------------------------------------------------
 * 3. The conversation model — streaming, TTFT, tools, usage
 * ------------------------------------------------------------------------ */

/**
 * Parses SSE the same way packages/llm/src/chat-stream.ts will have to: buffer
 * across chunk boundaries and split on a blank line. A network chunk landing
 * mid-`data:` line is the classic silent bug in this code, so the spike exercises
 * the same shape rather than a convenient shortcut.
 */
async function measureChatStream(model, messages, { tools, includeUsage } = {}) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        drop_params: true,
        temperature: 0.3,
        max_tokens: 200,
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        ...(tools ? { tools, tool_choice: "auto" } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: (await res.text()).slice(0, 300) };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let text = "";
  let ttftMs;
  let usage;
  let resolvedModel;
  const toolCalls = [];

  outer: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") break outer;

        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }

        resolvedModel ??= chunk.model;
        if (chunk.usage) usage = chunk.usage;

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          ttftMs ??= performance.now() - started;
          text += delta.content;
        }
        for (const tc of delta?.tool_calls ?? []) {
          ttftMs ??= performance.now() - started;
          const slot = (toolCalls[tc.index] ??= { name: "", args: "" });
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
        }
      }
    }
  }

  return {
    ok: true,
    ttftMs,
    totalMs: performance.now() - started,
    text,
    usage,
    resolvedModel,
    toolCalls: toolCalls.filter(Boolean),
    costHeader: res.headers.get("x-litellm-response-cost"),
  };
}

async function probeConverse() {
  heading("3. LLM  —  /chat/completions (streaming + tools)");

  if (!MODELS.converse) {
    console.log(`  ${c.yellow("Neither MODEL_CONVERSE nor MODEL_FAST is set.")} Skipping.`);
    return null;
  }
  row(
    "model",
    MODELS.converse,
    MODELS.converse === env.MODEL_FAST ? "(fell back to MODEL_FAST)" : "",
  );

  const messages = [
    {
      role: "system",
      content:
        "You are a voice companion in a car. Reply in one short spoken sentence. Never use markdown.",
    },
    { role: "user", content: "I keep going back and forth on whether to cut the field study." },
  ];

  console.log("");

  /* Warm-up, timed and reported separately.
   *
   * An idle self-hosted model takes 30-60s on the first request (.env.example
   * says so) and then answers in well under a second. Folding that into the
   * sample makes TTFT look catastrophic and the whole feature look impossible —
   * this spike measured 62s on its first run for exactly that reason. The cold
   * number is worth having, but it is a DIFFERENT number: it predicts how the
   * first turn of a drive feels when nobody has used the model recently. */
  const cold = await measureChatStream(MODELS.converse, messages, { includeUsage: true });
  if (!cold.ok) {
    console.log(`  ${c.red(`Streaming failed: ${cold.status ?? ""} ${cold.error ?? ""}`)}`);
    return null;
  }
  row(
    "cold start TTFT",
    ms(cold.ttftMs),
    cold.ttftMs > 5000 ? c.yellow("model was idle — the first turn of a drive pays this") : "",
  );

  const ttfts = [];
  let last;
  for (let i = 0; i < RUNS; i++) {
    last = await measureChatStream(MODELS.converse, messages, { includeUsage: true });
    if (last.ok && last.ttftMs !== undefined) ttfts.push(last.ttftMs);
  }

  if (!last?.ok) {
    console.log(`  ${c.red(`Streaming failed: ${last?.status ?? ""} ${last?.error ?? ""}`)}`);
    return null;
  }

  row("warm TTFT (streamed)", ms(pct(ttfts, 50)), summarise(ttfts));
  row("full reply", ms(last.totalMs), `${last.text.length} chars`);
  row("resolved model", last.resolvedModel ?? "—", "provenance — may differ from requested");
  console.log(`  ${c.dim(`said: "${last.text.trim().slice(0, 80)}"`)}`);

  console.log("");
  // stream_options.include_usage is how a streamed call reports token counts;
  // without it there is no usage at all and agent_turn rows lose their spend data.
  if (last.usage) {
    row(
      "stream_options usage",
      c.green("supported"),
      `prompt ${last.usage.prompt_tokens ?? "?"} · completion ${last.usage.completion_tokens ?? "?"}`,
    );
  } else {
    row(
      "stream_options usage",
      c.yellow("absent"),
      "no token counts on streamed calls — agent_turn spend will be null",
    );
  }

  // Cost is a response HEADER, and on a streamed response the proxy cannot know
  // it when headers are sent. Confirm, so chat-stream.ts leaves costUsd
  // undefined rather than inventing a zero.
  row(
    "x-litellm-response-cost",
    last.costHeader ?? c.yellow("absent"),
    last.costHeader ? "" : "expected on streamed calls — leave costUsd undefined, never 0",
  );

  /* Tool calling. The decisive question for MODEL_CONVERSE: a model that cannot
   * call tools cannot look anything up, which is half the feature. */
  console.log("");
  const withTools = await measureChatStream(
    MODELS.converse,
    [
      { role: "system", content: "You are a voice companion. Use tools when they would help." },
      { role: "user", content: "What did I say about the deadline last week?" },
    ],
    {
      includeUsage: true,
      tools: [
        {
          type: "function",
          function: {
            name: "search_transcript",
            description: "Search the user's own past spoken transcripts.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "What to search for" },
                since: { type: "string", description: "ISO date lower bound" },
              },
              required: ["query"],
            },
          },
        },
      ],
    },
  );

  if (!withTools.ok) {
    console.log(
      `  ${c.red("✗ TOOLS REJECTED")} — ${withTools.status ?? ""} ${(withTools.error ?? "").slice(0, 160)}\n` +
        `    ${c.bold("MODEL_CONVERSE must be a model that supports tool calling")} (this is why the\n` +
        `    plan gives it its own role rather than reusing MODEL_FAST).`,
    );
  } else if (withTools.toolCalls.length) {
    const call = withTools.toolCalls[0];
    console.log(
      `  ${c.green("✓ TOOLS WORK")} — called ${c.bold(call.name)}(${call.args.slice(0, 80)})\n` +
        `    Streamed tool-call deltas assembled correctly. TTFT ${ms(withTools.ttftMs)}.`,
    );
  } else {
    console.log(
      `  ${c.yellow("~ TOOLS ACCEPTED BUT UNUSED")} — the request did not error, but the model\n` +
        `    answered in prose instead of calling search_transcript. Either it cannot really\n` +
        `    call tools, or it needs a firmer system prompt. Retry with tool_choice forced\n` +
        `    before trusting this model for the agent.`,
    );
  }

  return { ttfts, usage: Boolean(last.usage), tools: withTools.ok && withTools.toolCalls.length > 0 };
}

/* --------------------------------------------------------------------------
 * 4. Embeddings (Phase 5, cheap to check while we are here)
 * ------------------------------------------------------------------------ */

async function probeEmbed() {
  heading("4. Embeddings  —  /embeddings");

  if (!MODELS.embed) {
    console.log(
      `  ${c.dim("MODEL_EMBED not set — Phase 5 only. Set it to a multilingual model")}\n` +
        `  ${c.dim("(bge-m3 / multilingual-e5-large, both 1024-d): the corpus is mixed German/English")}\n` +
        `  ${c.dim("and a monolingual embedder silently halves recall.")}`,
    );
    return null;
  }

  const started = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        model: MODELS.embed,
        input: ["the deadline for the field study", "Abgabefrist für die Feldstudie"],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const latencyMs = performance.now() - started;
    if (!res.ok) {
      row("status", c.red(String(res.status)), (await res.text()).slice(0, 120));
      return null;
    }
    const body = await res.json();
    const dims = body.data?.[0]?.embedding?.length;
    row("model", MODELS.embed);
    row("dimensions", dims ?? "—", "pin this in the transcript_embedding migration");
    row("latency (2 inputs)", ms(latencyMs));
    return { dims };
  } catch (err) {
    row("status", c.red("failed"), err instanceof Error ? err.message : String(err));
    return null;
  }
}

/* --------------------------------------------------------------------------
 * Finding a TTS model when the proxy will not list its models
 *
 * On the CAVI proxy, GET /models answers 401 ("No api key passed in") for a
 * virtual key that inference accepts perfectly well — so the usual "list the
 * models and grep for a TTS one" does not work here, and neither does the
 * worker's preflightLiteLLM model check.
 *
 * Probe instead. A wrong model name comes back as a fast 400/404, so walking a
 * candidate list costs almost nothing and turns "MODEL_SPEAK is not set" into
 * a name that can be pasted into .env.
 * ------------------------------------------------------------------------ */

async function listModels() {
  try {
    const res = await fetch(`${BASE_URL}/models`, {
      headers: auth,
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, status: res.status, models: [] };
    const body = await res.json();
    return { ok: true, models: (body.data ?? []).map((m) => m.id).filter(Boolean) };
  } catch {
    return { ok: false, models: [] };
  }
}

/**
 * Namespaced the way .env.example warns about: bare `whisper-1` does not exist
 * on this proxy, it is `openai/whisper-1`. So probe both bare and prefixed.
 *
 * Piper bakes the VOICE INTO THE MODEL ID (`cavi/piper-en_US-ryan-high`), which
 * is why a bare `cavi/piper` probe finds nothing — there is no such model, only
 * per-voice ones. A `voice` parameter is meaningless for these and is ignored.
 * Self-hosted entries come first: they are the ones that keep participant speech
 * on university infrastructure, so a run should recommend them over a hosted
 * model whenever both work.
 */
const TTS_CANDIDATES = [
  "cavi/piper-en_US-ryan-high",
  "cavi/piper-en_US-lessac-medium",
  "cavi/piper-da_DK-talesyntese-medium",
  "cavi/kokoro",
  "cavi/kokoro-82m",
  "cavi/xtts-v2",
  "cavi/orpheus",
  "tts-1",
  "openai/tts-1",
  "openai/tts-1-hd",
  "openai/gpt-4o-mini-tts",
  "elevenlabs/eleven_turbo_v2_5",
];

async function probeTtsCandidates() {
  heading("Finding a TTS model");
  console.log(
    `  ${c.dim("Probing candidate names directly — this proxy does not serve GET /models to")}\n` +
      `  ${c.dim("this key, so the model list cannot be grepped.")}\n`,
  );

  const found = [];
  for (const model of TTS_CANDIDATES) {
    const r = await measureSpeak(model, "Testing one two.", "wav");
    if (r.ok) {
      found.push(model);
      row(model, c.green("works"), `${(r.bytes / 1024).toFixed(0)}KB · first byte ${ms(r.firstByteMs)}`);
    } else if (r.status && r.status !== 400 && r.status !== 404) {
      // 400/404 is just "no such model" — noise. Anything else is worth seeing.
      row(model, c.yellow(String(r.status)), (r.error ?? "").slice(0, 70));
    }
  }

  console.log("");
  if (found.length) {
    console.log(`  ${c.green("✓")} Set ${c.bold(`MODEL_SPEAK=${found[0]}`)} in .env and re-run this spike.`);
  } else {
    console.log(
      `  ${c.red("✗ No TTS model responded.")} Talk-back cannot speak until one is deployed.\n` +
        `    Ask the LiteLLM admin to add a TTS model (kokoro and piper are small, fast,\n` +
        `    self-hostable, and keep participant speech on university infrastructure).\n` +
        `    ${c.bold("This blocks Phase 2, but not Phase 1")} — the one-directional pipe and the\n` +
        `    live transcript need no TTS at all.`,
    );
  }
  return found;
}

/* ------------------------------------------------------------------------ */

console.log(`\n${c.bold("VoiceMural talk-back spike")}  ${c.dim(BASE_URL)}`);
console.log(c.dim(`runs=${RUNS} contention=${CONTENTION}`));

const available = await listModels();
if (!available.ok) {
  console.log(
    c.dim(
      `GET /models → ${available.status ?? "failed"}; model discovery falls back to probing.`,
    ),
  );
}

let speak = await probeSpeak();
if (!speak) {
  const found = await probeTtsCandidates();
  // Re-run the real TTS measurement against whatever answered, so a run with no
  // MODEL_SPEAK in .env still produces the streaming verdict and a TTS TTFB for
  // the budget rather than two dashes.
  if (found.length) {
    MODELS.speak = found[0];
    speak = await probeSpeak();
  }
}

// Real speech beats a synthetic tone for ASR timing, and if TTS works we can
// generate it here rather than shipping a fixture WAV. Whisper's decoder does
// less work on noise it cannot resolve into words, so a tone would flatter the
// numbers — the fallback says so.
let speechSource = { kind: "synthetic", note: c.yellow("no TTS — timings indicative only") };
if (speak?.body) {
  const decoded = speak.format === "wav" ? decodeWav(speak.body) : null;
  if (decoded) {
    speechSource = {
      kind: "TTS speech",
      note: `${decoded.sampleRate}Hz from ${MODELS.speak}`,
      samples: decoded.samples,
    };
  } else {
    speechSource.note = c.yellow(
      `TTS returned ${speak.format}, which this script cannot decode — using synthetic audio`,
    );
  }
}

const asr = await probeTranscribe(speechSource);
const llm = await probeConverse();
await probeEmbed();

/* --------------------------------------------------------------------------
 * The budget
 * ------------------------------------------------------------------------ */

heading("Budget  —  user stops talking → first audible sample");

const VAD_ENDPOINT_MS = 600; // §2 of the plan; the biggest single lever
const NETWORK_MS = 80; // PCM tail + WS RTT, overlapped upload
const CLIENT_DECODE_MS = 50;

const asrMs = asr ? pct(asr.warm[5] ?? [], 50) : undefined;
const asrLoadedMs = asr?.contended?.length ? pct(asr.contended, 50) : undefined;
const ttftMs = llm ? pct(llm.ttfts, 50) : undefined;
/* Use the clause-chunked figure where the backend's cost is marginal rather
 * than fixed: under sentence/clause pipelining that is the wait the user
 * actually experiences, and the whole-sentence number would overstate it. */
const ttsMs = speak?.clauseTtfbMs ?? speak?.firstByteMs;
const ttsChunked = speak?.clauseTtfbMs !== undefined && speak.clauseTtfbMs < speak.firstByteMs;

row("VAD endpoint hold", ms(VAD_ENDPOINT_MS), "assumed — tune 400-800 in the browser");
row("network (PCM tail + RTT)", ms(NETWORK_MS), "assumed — car LTE spikes to 500ms+");
row("ASR (5s turn, idle GPU)", ms(asrMs), "measured");
row("ASR (5s turn, loaded GPU)", ms(asrLoadedMs), "measured — this is the real one during a drive");
row("LLM TTFT", ms(ttftMs), "measured");
row(
  "TTS TTFB",
  ms(ttsMs),
  ttsChunked
    ? `measured — first ~30-char clause (whole sentence would be ${ms(speak.firstByteMs)})`
    : "measured",
);
row("client decode + schedule", ms(CLIENT_DECODE_MS), "assumed");

if (asrMs && ttftMs && ttsMs) {
  const idle = VAD_ENDPOINT_MS + NETWORK_MS + asrMs + ttftMs + ttsMs + CLIENT_DECODE_MS;
  const loaded =
    VAD_ENDPOINT_MS + NETWORK_MS + (asrLoadedMs ?? asrMs) + ttftMs + ttsMs + CLIENT_DECODE_MS;
  console.log("");
  row("TOTAL, idle GPU", c.bold(ms(idle)));
  row("TOTAL, during a drive", c.bold(ms(loaded)), "chunk pipeline running");

  /* What the perceptual measures can and cannot cover.
   *
   * A backchannel ("mm", "right") buys silence-tolerance, not unlimited time. In
   * conversation a gap past roughly two seconds reads as being ignored, and no
   * amount of "mm" covers a five-second wait — it makes it worse, because the
   * system has now promised an answer it cannot deliver. So the ceiling is a
   * real constraint, not a soft target: cut the pipeline below it, or the
   * feature does not work regardless of how the waiting is dressed up. */
  const BACKCHANNEL_COVERS_MS = 2000;
  const speculativeSaving = VAD_ENDPOINT_MS - 250;
  const perceived = loaded - speculativeSaving;

  console.log("");
  console.log(
    `  ${c.dim("Perceptual measures available:")}\n` +
      `  ${c.dim(`· speculative ASR start at 250ms silence      −${ms(speculativeSaving)}`)}\n` +
      `  ${c.dim(`· pre-synthesised backchannel on endpoint      covers ~${ms(BACKCHANNEL_COVERS_MS)} of gap`)}\n` +
      `  ${c.dim("· sentence-pipelined TTS                       only if TTS cost scales with length")}`,
  );
  console.log("");

  if (perceived <= BACKCHANNEL_COVERS_MS) {
    console.log(
      `  ${c.green("✓ VIABLE.")} Real ${c.bold(ms(loaded))}, ${ms(perceived)} with speculative start —\n` +
        `    inside what a backchannel can cover, so it will feel responsive.`,
    );
  } else {
    console.log(
      `  ${c.red(`✗ NOT VIABLE AS BUILT: ${ms(perceived)} during a drive.`)}\n` +
        `    That is ${c.bold(`${(perceived / BACKCHANNEL_COVERS_MS).toFixed(1)}x`)} what a backchannel can plausibly cover. Tricks cannot\n` +
        `    close this gap — the pipeline itself has to get shorter.\n`,
    );

    // Rank the fixes by how much each actually removes, measured rather than assumed.
    const fixes = [];
    if (asrLoadedMs && asrMs && asrLoadedMs - asrMs > 400) {
      fixes.push([
        asrLoadedMs - asrMs,
        "A dedicated live ASR deployment (MODEL_TRANSCRIBE_LIVE)",
        "the live path stops queueing behind the chunk pipeline's batchSize-4 jobs",
      ]);
    }
    /* Only recommend a different TTS when the backend itself is the problem —
     * i.e. a large FIXED cost that no amount of chunking can avoid. When the
     * cost is marginal, clause-chunking already handles it and is assumed in
     * `ttsMs` above, so recommending a new deployment here would be double
     * counting a saving already taken. */
    if (ttsMs && ttsMs > 300 && !ttsChunked) {
      fixes.push([
        ttsMs - 200,
        "A self-hosted low-latency TTS (kokoro-82m / piper, ~150-250ms)",
        "also removes the privacy problem: no participant speech leaves AU",
      ]);
    }
    if (asrMs && asrMs > 700) {
      fixes.push([
        asrMs - 500,
        "A smaller/faster Whisper for the live path (distil-large-v3, small)",
        `large-v3 runs at RTF ${(asrMs / 5000).toFixed(2)} here — live ASR is a working copy, not the ledger`,
      ]);
    }
    fixes.sort((a, b) => b[0] - a[0]);

    console.log(`    ${c.bold("What would, in order of measured benefit:")}`);
    let projected = loaded - speculativeSaving;
    for (const [saving, what, why] of fixes) {
      projected -= saving;
      console.log(`    ${c.green(`−${ms(saving)}`)}  ${what}\n            ${c.dim(why)}`);
    }
    console.log(
      `\n    Together: ${c.bold(ms(Math.max(0, projected)))} — ` +
        (projected <= BACKCHANNEL_COVERS_MS
          ? c.green("inside the backchannel budget. This is the infrastructure ask.")
          : c.yellow("still over. Streaming ASR (WhisperLive) becomes necessary too.")),
    );
  }
}

/* --------------------------------------------------------------------------
 * What is still unknown
 * ------------------------------------------------------------------------ */

heading("Still unmeasured  —  these need a browser and a car");

console.log(
  `  ${c.bold("1. Bluetooth HFP.")} With talk-back always on, playing TTS while the mic is open\n` +
    `     can flip the car link to HFP narrowband (8/16kHz) — degrading the VERBATIM\n` +
    `     LEDGER on every drive, silently. In the car, log\n` +
    `     ${c.dim("stream.getAudioTracks()[0].getSettings()")} before and during playback.\n` +
    `     If sampleRate drops, that is the finding that reshapes the deployment.\n`,
);
console.log(
  `  ${c.bold("2. WebSocket through Traefik.")} Does an upgrade survive Coolify's proxy, and\n` +
    `     does it stay open through 10 minutes idle? Measure once apps/realtime deploys.\n` +
    `     App-level ping/pong at 15s is in the plan precisely because the answer is\n` +
    `     not something to discover on the motorway.\n`,
);

if (available.ok && available.models.length) {
  const likelyEmbed = available.models.filter((m) => /embed|bge|e5|gte|minilm/i.test(m));
  if (likelyEmbed.length && !MODELS.embed) {
    heading("Models on this proxy");
    console.log(`  ${c.bold("Embed candidates:")} ${likelyEmbed.join(", ")}`);
  }
}

console.log("");
