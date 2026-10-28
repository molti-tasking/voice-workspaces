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
  const { baseUrl, apiKey } = litellmConfig();
  const endpoint = `${baseUrl}/realtime/client_secrets`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    // The model twice: the proxy routes on the top-level one, the provider
    // configures the session from the nested one.
    body: JSON.stringify({ model: session.model, session }),
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
