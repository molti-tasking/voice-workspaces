import { emitGeneration, type GenerationContext } from "./observe";
import type { SpeakResult } from "./speak";

/**
 * ElevenLabs, called directly rather than through LiteLLM.
 *
 * Direct because LiteLLM's `/audio/speech` is an OpenAI-shaped envelope, and the
 * parameters that matter for a conversational voice — `optimize_streaming_latency`,
 * `output_format`, the stability/similarity knobs — have nowhere to live in it.
 * The video pipeline in this repo already calls ElevenLabs directly for the same
 * reason, so this follows an established pattern rather than inventing one.
 *
 * WHEN THIS IS THE RIGHT CHOICE. Voice quality is the thing `persona` is
 * supposed to manipulate, and a synthetic-sounding voice undermines the
 * manipulation before the register ever gets a chance to matter. ElevenLabs is
 * the realism benchmark, and for a study the per-drive cost is trivial: a reply
 * is one or two sentences, so a long drive is a few thousand characters.
 *
 * WHEN IT IS NOT. It sends the agent's words — which quote the participant's own
 * thinking back to them — to a US vendor. That is a smaller step than sending
 * audio, and a larger one than sending nothing. Self-hosted Kokoro or Piper via
 * `MODEL_SPEAK` keeps everything on university hardware, and the provider is one
 * env var away.
 */

/** Flash is the low-latency model; v3 trades ~175ms for noticeably better prosody. */
const DEFAULT_MODEL = "eleven_flash_v2_5";

/**
 * Raw PCM, not mp3.
 *
 * The client plays through a Web Audio ring buffer so it knows exactly how many
 * samples have been heard — which is what makes barge-in truncation honest, and
 * what lets `agent_turn.text` record what the user actually heard rather than
 * what was generated. An encoded format would have to be fully decoded first,
 * which reintroduces the latency streaming was for.
 *
 * NOTE: PCM output requires a paid ElevenLabs plan. On a free key this 400s, and
 * `speakElevenLabs` reports that plainly rather than silently returning mp3 that
 * the ring buffer would play as noise.
 */
const PCM_RATE = 24_000;

export function elevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export interface ElevenLabsOptions {
  voiceId?: string;
  modelId?: string;
  signal?: AbortSignal;
  context?: GenerationContext;
}

export async function speakElevenLabs(
  text: string,
  options: ElevenLabsOptions = {},
): Promise<SpeakResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set.");

  // A study needs the same voice for every participant, or `persona` is not a
  // controlled variable. Hence a configured id rather than a per-call choice.
  const voiceId = options.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    throw new Error(
      "ELEVENLABS_VOICE_ID is not set. Pick one voice and keep it fixed across the study.",
    );
  }

  const modelId = options.modelId ?? process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL;
  const context = options.context ?? {};
  const startedAt = Date.now();

  const properties = () => ({ chars: text.length, voice_id: voiceId, ...context.extra });

  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=pcm_${PCM_RATE}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/pcm",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          // Streams the first chunk sooner at a small cost in prosody planning.
          // Worth it here: this is one clause of a spoken reply, not narration.
          optimize_streaming_latency: 3,
        }),
        signal: options.signal,
      },
    );
  } catch (err) {
    emitGeneration({
      spanName: "speak",
      model: `elevenlabs/${modelId}`,
      latencyMs: Date.now() - startedAt,
      context,
      input: [{ role: "assistant", content: text }],
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
      model: `elevenlabs/${modelId}`,
      latencyMs: ttfbMs,
      context,
      input: [{ role: "assistant", content: text }],
      httpStatus: res.status,
      error: body.slice(0, 500),
      properties: properties(),
    });

    // The failure worth naming: PCM is a paid feature, and the error otherwise
    // reads as a generic 400 that looks like a bad request.
    const hint =
      res.status === 400 && body.includes("output_format")
        ? " — pcm output requires a paid ElevenLabs plan"
        : "";
    throw new Error(`ElevenLabs ${res.status}${hint}: ${body.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("ElevenLabs returned no body");

  emitGeneration({
    spanName: "speak",
    model: `elevenlabs/${modelId}`,
    latencyMs: ttfbMs,
    context,
    input: [{ role: "assistant", content: text }],
    httpStatus: res.status,
    properties: properties(),
  });

  return {
    stream: res.body,
    requestedModel: `elevenlabs/${modelId}`,
    resolvedModel: `elevenlabs/${modelId}`,
    format: "pcm",
    sampleRate: PCM_RATE,
    ttfbMs,
    contentType: res.headers.get("content-type") ?? undefined,
  };
}
