/**
 * A speech-to-speech conversation, reached through the LiteLLM proxy.
 *
 * THE BROWSER TALKS TO THE MODEL, NOT THROUGH US. The proxy's WebRTC support
 * (`/realtime/client_secrets`, `/realtime/calls`) mints a short-lived secret
 * for one session, the browser posts its SDP offer to the proxy with it, and
 * the audio then flows between the phone and the provider directly — it never
 * passes the proxy or this server. So the only server-side step is this one:
 * turn the proxy key, which must never reach a browser, into a secret that is
 * good for one session for a few minutes.
 *
 * The session is configured HERE, at mint time — the instructions, the voice,
 * transcription and turn detection — rather than by the browser once it is
 * connected. The secret is bound to that configuration, so what the agent was
 * told is decided by the server and recorded by the server.
 *
 * Through the proxy only OpenAI's realtime models work this way: the proxy's
 * WebRTC routes forward to OpenAI and Azure, and a Gemini Live model there is
 * reachable over a WebSocket only, which a browser cannot authenticate to.
 */

import { LiteLLMError, litellmConfig } from "./config";

/** The session as the realtime API takes it, at mint time. */
export interface RealtimeSessionConfig {
  type: "realtime";
  /** The proxy's name for the model, e.g. `openai/gpt-realtime-2.1`. */
  model: string;
  instructions: string;
  audio: {
    input: {
      transcription?: { model: string; language?: string };
      noise_reduction?: { type: "near_field" | "far_field" } | null;
      turn_detection:
        | { type: "semantic_vad"; eagerness: RealtimeEagerness; create_response?: boolean; interrupt_response?: boolean }
        | {
            type: "server_vad";
            threshold?: number;
            prefix_padding_ms?: number;
            silence_duration_ms?: number;
            create_response?: boolean;
            interrupt_response?: boolean;
          };
    };
    output: { voice: string };
  };
  /** Functions the model may call; the browser runs them and hands back the result. */
  tools?: RealtimeFunctionTool[];
  tool_choice?: "auto" | "none";
}

/** A function the realtime model may call, in the provider's flat form. */
export interface RealtimeFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** How readily the provider ends their turn: `low` waits longest for them to go on. */
export type RealtimeEagerness = "low" | "medium" | "high" | "auto";

/** How much audio a streaming transcription model hears before it writes: less is sooner, more is surer. */
export type TranscriptionDelay = "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * A transcription-only session (`gpt-live-transcribe`): what they say as
 * text while they are still saying it, and no voice. The speech-to-speech
 * session transcribes a turn only once it is over, and its transcription
 * model cannot stream; the live words come from this one, run beside it on
 * the same microphone track.
 */
export interface RealtimeTranscriptionConfig {
  type: "transcription";
  audio: {
    input: {
      transcription: { model: string; language?: string; delay?: TranscriptionDelay };
      noise_reduction?: { type: "near_field" | "far_field" } | null;
      turn_detection: { type: "server_vad"; silence_duration_ms?: number } | null;
    };
  };
}

export interface RealtimeSecret {
  /** The secret the browser authorises its SDP offer with. */
  value: string;
  /** When it stops working for a NEW call, epoch ms. A call already up is unaffected. */
  expiresAt: number;
  /** The model the provider says the session runs — not the proxy's alias. */
  resolvedModel: string | null;
  /** Where the browser posts its SDP offer. */
  callsUrl: string;
}

/**
 * Mint a one-session secret for `session`.
 *
 * Throws `LiteLLMError` for a refusal — an unknown model, a key the proxy does
 * not accept, a model the proxy cannot serve in realtime — with the proxy's own
 * words, which name the cause far better than a status does.
 */
export async function mintRealtimeSecret(
  session: RealtimeSessionConfig,
  { timeoutMs = 10_000 }: { timeoutMs?: number } = {},
): Promise<RealtimeSecret> {
  return mintSecret(litellmConfig(), session.model, session, timeoutMs);
}

/** OpenAI itself, for what the proxy cannot carry (`openaiDirectConfig`). */
export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * OpenAI reached directly, with `OPENAI_API_KEY`: only for the live
 * transcription, which the proxy cannot carry — LiteLLM forwards the model
 * onto a transcription call, and OpenAI refuses every transcription call that
 * names one ("Model … is not supported in transcription mode"; fixed in
 * LiteLLM for WebSockets on 5 Oct 2026, PR #43854, not for WebRTC calls).
 * Null without a key. Server only: the browser is handed a one-session secret.
 */
export function openaiDirectConfig(): ProviderConfig | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  return { baseUrl, apiKey };
}

/**
 * Mint a one-session secret for a transcription-only session. Through the
 * proxy, `model` is its name for the model (`openai/gpt-live-transcribe`),
 * which it routes on; `direct` mints at OpenAI itself (`openaiDirectConfig`),
 * which takes the session alone. Either way the session names the model by
 * the provider's name, and the browser opens it like a call on `callsUrl`.
 */
export async function mintTranscriptionSecret(
  model: string,
  session: RealtimeTranscriptionConfig,
  { timeoutMs = 10_000, direct = null }: { timeoutMs?: number; direct?: ProviderConfig | null } = {},
): Promise<RealtimeSecret> {
  return direct ? mintSecret(direct, null, session, timeoutMs) : mintSecret(litellmConfig(), model, session, timeoutMs);
}

async function mintSecret(
  { baseUrl, apiKey }: ProviderConfig,
  /** The proxy's routing name; null when minting at the provider itself. */
  model: string | null,
  session: RealtimeSessionConfig | RealtimeTranscriptionConfig,
  timeoutMs: number,
): Promise<RealtimeSecret> {
  const endpoint = `${baseUrl}/realtime/client_secrets`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // Through the proxy, the model twice: it routes on the top-level one, the
    // provider configures the session from the nested one.
    body: JSON.stringify(model === null ? { session } : { model, session }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new LiteLLMError(res.status, body, "/realtime/client_secrets");

  let parsed: { value?: unknown; expires_at?: unknown; session?: { model?: unknown } };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new LiteLLMError(res.status, body, "/realtime/client_secrets");
  }
  if (typeof parsed.value !== "string" || !parsed.value) {
    throw new LiteLLMError(res.status, "no client secret in the response", "/realtime/client_secrets");
  }
  return {
    value: parsed.value,
    // Seconds on the wire. A missing expiry is read as the provider's usual
    // ten minutes rather than as "never".
    expiresAt: typeof parsed.expires_at === "number" ? parsed.expires_at * 1000 : Date.now() + 600_000,
    resolvedModel: typeof parsed.session?.model === "string" ? parsed.session.model : null,
    callsUrl: `${baseUrl}/realtime/calls`,
  };
}
