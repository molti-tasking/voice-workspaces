import { LiteLLMError, litellmConfig, modelFor } from "./config";
import { emitGeneration, type GenerationContext } from "./observe";

/**
 * Text to speech via LiteLLM's OpenAI-compatible `/audio/speech`.
 *
 * The agent's half of the dialogue. Measured against the CAVI proxy with
 * `cavi/piper-en_US-ryan-high` (see scripts/spike-talkback.mjs), which shapes
 * three things in here:
 *
 * 1. **The voice is baked into the model id.** Piper deploys one model per
 *    voice, so a `voice` parameter is meaningless and is not sent. Changing
 *    voice means changing MODEL_SPEAK — which is exactly what the role
 *    indirection is for.
 * 2. **Cost is ~61ms fixed + 12.5ms per character.** Almost entirely marginal,
 *    the opposite of hosted tts-1 (634ms fixed + 7.1ms/char). Time to first
 *    audio is therefore set by how much text is in the FIRST request, not by
 *    the backend — hence `splitForSpeech` below, and why the caller should
 *    speak clause by clause rather than all at once.
 * 3. **Content-Type lies.** The proxy answers `audio/mpeg` whatever
 *    `response_format` was asked for, while the bytes correctly honour the
 *    request. So the format is reported back from what we REQUESTED; trusting
 *    the header would hand mp3 frames to a PCM ring buffer and play noise.
 */

export type SpeechFormat = "wav" | "pcm" | "mp3" | "opus";

export interface SpeakResult {
  /**
   * The audio body, unread.
   *
   * Deliberately NOT buffered: the caller pipes this to the client so playback
   * can begin before synthesis finishes. Reading it to completion here would
   * defeat the entire purpose of the function.
   */
  stream: ReadableStream<Uint8Array>;
  requestedModel: string;
  /**
   * What LiteLLM reports it actually used, when it reports anything.
   *
   * `/audio/speech` returns audio, not JSON, so unlike `chat()` there is no
   * response body to read a model name out of. LiteLLM sometimes sets
   * `x-litellm-model-id`; when it does not, this is the requested name.
   */
  resolvedModel: string;
  /**
   * The format the caller ASKED for. Decode by this, never by Content-Type.
   */
  format: SpeechFormat;
  /**
   * Sample rate of the PCM, once decoded.
   *
   * Carried explicitly because it is not recoverable from raw PCM and the
   * player must resample to the output device. Piper through LiteLLM returns
   * 22050 or 24000 depending on the voice; ElevenLabs PCM is whatever was
   * requested.
   */
  sampleRate: number;
  /** Time to response headers. */
  ttfbMs: number;
  /** What the server said it was sending, kept only to prove it disagrees. */
  contentType?: string;
  costUsd?: number;
}

export interface SpeakOptions {
  format?: SpeechFormat;
  /** 0.25–4.0 where supported. Piper ignores it. */
  speed?: number;
  /**
   * Ignored by voice-per-model backends like Piper, and sent only when given so
   * a hosted fallback (tts-1) can still be steered.
   */
  voice?: string;
  signal?: AbortSignal;
  context?: GenerationContext;
}

/** Undefined rather than 0: a zero is indistinguishable from a free call. */
function parseCostHeader(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Where speech comes from.
 *
 * `litellm` keeps synthesis on university infrastructure (Piper today, Kokoro
 * when deployed) at the cost of voice quality. `elevenlabs` is the realism
 * benchmark at the cost of sending the agent's words — which quote the
 * participant back to them — to a US vendor.
 *
 * Defaults to `litellm`, so the privacy-preserving option is the one you get by
 * not deciding.
 */
export type SpeechProvider = "litellm" | "elevenlabs" | "synthetic";

export function speechProvider(): SpeechProvider {
  const configured = process.env.TTS_PROVIDER;
  if (configured === "elevenlabs" || configured === "synthetic") return configured;
  return "litellm";
}

/**
 * Synthesise one clause, from whichever provider is configured.
 *
 * Both paths return a stream of PCM at a stated rate, so nothing downstream —
 * the socket, the ring buffer, the barge-in accounting — knows or cares which
 * one answered.
 */
export async function synthesise(text: string, options: SpeakOptions = {}): Promise<SpeakResult> {
  const provider = speechProvider();

  if (provider === "elevenlabs") {
    const { speakElevenLabs } = await import("./speak-elevenlabs");
    return speakElevenLabs(text, { signal: options.signal, context: options.context });
  }

  // Diagnostic only, and never a fallback: a study must not accidentally record
  // participants listening to a buzz. It has to be asked for by name.
  if (provider === "synthetic") {
    const { speakSynthetic } = await import("./speak-synthetic");
    return speakSynthetic(text);
  }

  return speak(text, options);
}

export async function speak(text: string, options: SpeakOptions = {}): Promise<SpeakResult> {
  const { baseUrl, apiKey } = litellmConfig();
  const endpoint = `${baseUrl}/audio/speech`;
  const requestedModel = modelFor("speak");
  const format = options.format ?? "wav";

  const context = options.context ?? {};
  const startedAt = Date.now();

  const describeInput = () => [{ role: "assistant", content: text }];
  const properties = () => ({
    chars: text.length,
    format,
    model_voice: requestedModel,
    ...context.extra,
  });

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: requestedModel,
        input: text,
        response_format: format,
        ...(options.voice ? { voice: options.voice } : {}),
        ...(options.speed !== undefined ? { speed: options.speed } : {}),
      }),
      signal: options.signal,
    });
  } catch (err) {
    // Covers both a dead proxy and a barge-in abort. Worth seeing either way:
    // an abort here is a user interrupting, which is turn-taking data.
    emitGeneration({
      spanName: "speak",
      model: requestedModel,
      latencyMs: Date.now() - startedAt,
      context,
      input: describeInput(),
      error: err instanceof Error ? err.message : String(err),
      properties: properties(),
    });
    throw err;
  }

  const ttfbMs = Date.now() - startedAt;

  if (!res.ok) {
    const body = await res.text();
    emitGeneration({
      spanName: "speak",
      model: requestedModel,
      latencyMs: ttfbMs,
      context,
      input: describeInput(),
      httpStatus: res.status,
      error: body.slice(0, 500),
      properties: properties(),
    });
    throw new LiteLLMError(res.status, body, "/audio/speech");
  }

  if (!res.body) {
    throw new LiteLLMError(res.status, "no response body", "/audio/speech");
  }

  // Emitted at headers rather than at end of stream: the caller may abort
  // mid-playback on barge-in, and an observation that only fires on clean
  // completion would systematically under-report exactly the turns that are
  // most interesting. `latencyMs` is TTFB, which is the number that matters.
  emitGeneration({
    spanName: "speak",
    model: requestedModel,
    latencyMs: ttfbMs,
    context,
    input: describeInput(),
    httpStatus: res.status,
    costUsd: parseCostHeader(res.headers.get("x-litellm-response-cost")),
    properties: properties(),
  });

  return {
    stream: res.body,
    requestedModel,
    resolvedModel: res.headers.get("x-litellm-model-id") ?? requestedModel,
    format,
    // Piper's rate varies by voice and the proxy does not report it. 22050 is
    // what the en_US voices produce; a wrong guess only matters for `wav`,
    // where the real rate is read from the header instead.
    sampleRate: Number(process.env.MODEL_SPEAK_SAMPLE_RATE ?? 22_050),
    ttfbMs,
    contentType: res.headers.get("content-type") ?? undefined,
    costUsd: parseCostHeader(res.headers.get("x-litellm-response-cost")),
  };
}

/**
 * Rough rate at which synthesised speech plays back, in ms per character.
 *
 * English runs about 14-15 characters per second spoken. Only used to reason
 * about whether the next chunk can be synthesised before the current one
 * finishes playing — nothing depends on it being exact.
 */
const PLAYBACK_MS_PER_CHAR = 70;

/**
 * Measured synthesis rate for the Piper deployment, in ms per character.
 * See scripts/spike-talkback.mjs: ~61ms fixed + 12.5ms/char.
 */
const SYNTHESIS_MS_PER_CHAR = 12.5;

/**
 * How much longer a chunk may be than the one before it.
 *
 * Synthesis runs ~5.6x faster than playback (70 / 12.5), so chunk N+1 can be up
 * to ~5.6x chunk N and still be ready in time. Held below that for margin:
 * network jitter and a cold model both eat into it, and running out means an
 * audible gap in the middle of a sentence.
 */
const CHUNK_GROWTH = 3.5;

/**
 * Split a reply into speakable chunks that keep the audio flowing.
 *
 * Two constraints pull against each other:
 *
 * 1. **Time to first audio** wants a small opening chunk. The backend costs
 *    ~12.5ms per character with almost no fixed cost, so 40 characters is ~500ms
 *    while a 200-character opening sentence is two and a half seconds of silence.
 *    Splitting on sentence-final punctuation alone does not achieve this — clause
 *    boundaries (comma, dash, colon, semicolon) do, and a spoken reply pauses
 *    there anyway, so the seam is inaudible.
 *
 * 2. **No gaps afterwards** wants chunks that do not grow too fast. Chunk N+1 is
 *    synthesised while chunk N plays, so it has `70ms * len(chunk N)` to finish
 *    in and needs `12.5ms * len(chunk N+1)`. A tiny opening chunk followed by a
 *    long one is therefore the worst case, not the best: "Right," (6 chars,
 *    ~0.4s of audio) followed by a 191-character chunk (~2.4s to synthesise)
 *    leaves a two-second hole right after the agent starts talking. That is
 *    worse than simply having started half a second later.
 *
 * So chunks ramp: a small first one, then each up to `CHUNK_GROWTH` times the
 * last, capped. Very short fragments are merged rather than emitted alone —
 * they sound clipped, cost a request, and buy nothing.
 */
export function splitForSpeech(
  text: string,
  options: {
    firstChunkChars?: number;
    laterChunkChars?: number;
    /**
     * Hard ceiling on the opening chunk, past which it is cut at a word
     * boundary even though that lands mid-clause.
     *
     * Preferring whole clauses is right, but unbounded it is not: a reply that
     * opens with a 200-character subordinate clause would be two and a half
     * seconds of silence before the agent makes any sound, which reads as the
     * system having failed. Splitting mid-clause costs a small prosody seam —
     * each chunk is synthesised independently, so the intonation resets — and
     * that is the cheaper of the two.
     *
     * Only the FIRST chunk has this ceiling. Later ones synthesise while earlier
     * audio plays, so their length is free.
     */
    firstChunkHardMax?: number;
    /**
     * Shortest chunk worth emitting on its own.
     *
     * A two-word fragment costs a whole request, sounds clipped because the
     * backend resets prosody per chunk, and — worse — makes the NEXT chunk's
     * deadline impossibly tight, since it only buys a moment of playback to
     * synthesise behind.
     */
    minChunkChars?: number;
  } = {},
): string[] {
  const firstMax = options.firstChunkChars ?? 40;
  const laterMax = options.laterChunkChars ?? 240;
  const firstHardMax = options.firstChunkHardMax ?? 80;
  const minChunk = options.minChunkChars ?? 20;

  const trimmed = text.trim();
  if (!trimmed) return [];

  // Keep the delimiter with the clause it ends: the TTS needs the punctuation
  // to get the prosody right, and a trailing comma is what makes a chunk sound
  // like it continues rather than stops.
  const pieces = trimmed
    .split(/(?<=[.!?…]["')\]]?\s)|(?<=[,;:—–-]\s)/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  /** Ceiling for the chunk being built, from position and the ramp. */
  const limit = () => {
    const previous = chunks[chunks.length - 1];
    if (!previous) return firstMax;
    return Math.min(laterMax, Math.max(firstMax, Math.round(previous.length * CHUNK_GROWTH)));
  };

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };

  for (const piece of pieces) {
    if (!current) {
      current = piece;
    } else if (`${current} ${piece}`.length <= limit()) {
      current = `${current} ${piece}`;
      continue;
    } else if (current.length < minChunk) {
      // Adding the piece overflows, but shipping what we have would emit a
      // fragment too short to cover the next chunk's synthesis. Overshoot
      // deliberately: a slightly long chunk is better than a gap after it.
      current = `${current} ${piece}`;
    } else {
      flush();
      current = piece;
    }

    if (current.length >= limit()) {
      // A clause past the limit is shipped whole — cutting inside it is
      // audible, and slightly late beats slightly chopped. Except for an
      // opening clause past the HARD limit, where the wait itself is the
      // bigger problem.
      if (chunks.length === 0 && current.length > firstHardMax) {
        const [head, tail] = cutAtWordBoundary(current, firstHardMax);
        chunks.push(head);
        current = tail;
        continue;
      }
      flush();
    }
  }

  flush();
  return chunks;
}

/**
 * Where the audio would run dry, given how chunks were split.
 *
 * Returns the index of each chunk that cannot be synthesised before the
 * previous one finishes playing. Empty means the reply plays without a gap.
 *
 * Exported for tests and for the bench script rather than used at runtime: the
 * rates are approximations, and the useful thing is being able to assert that a
 * splitting change did not quietly reintroduce a stall.
 */
export function findSpeechGaps(chunks: string[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < chunks.length; i++) {
    const previous = chunks[i - 1];
    const next = chunks[i];
    if (!previous || !next) continue;
    const playbackBudgetMs = previous.length * PLAYBACK_MS_PER_CHAR;
    const synthesisMs = next.length * SYNTHESIS_MS_PER_CHAR;
    if (synthesisMs > playbackBudgetMs) gaps.push(i);
  }
  return gaps;
}

/**
 * Cut at the last word boundary at or before `limit`.
 *
 * Returns the whole string as the head when there is no boundary to use — a
 * single unbroken token longer than the limit (a URL, a long compound) has
 * nowhere to cut that would not mangle it.
 */
function cutAtWordBoundary(text: string, limit: number): [string, string] {
  const space = text.lastIndexOf(" ", limit);
  if (space <= 0) return [text, ""];
  return [text.slice(0, space).trim(), text.slice(space + 1).trim()];
}
