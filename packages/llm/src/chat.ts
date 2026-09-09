import {
  LiteLLMError,
  litellmConfig,
  modelFor,
  parseCostHeader,
  type ModelRole,
} from "./config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * A completion plus everything needed to record it as provenance.
 *
 * The response envelope is deliberately not discarded. Extractions are stored
 * so the workspace can be rebuilt without re-calling the model, and a stored
 * extraction is only worth anything if it says which model produced it and what
 * it cost.
 */
export interface ChatResult {
  content: string;
  /**
   * The model LiteLLM actually used.
   *
   * Not the same as what we asked for: aliases, wildcards and fallbacks all mean
   * the request name can differ from the model that answered. Only this one is
   * true provenance.
   */
  resolvedModel: string;
  requestedModel: string;
  usage: TokenUsage;
  latencyMs: number;
  /**
   * What LiteLLM says the call cost, in USD, when it says anything.
   *
   * Read from the `x-litellm-response-cost` response header. This is the only
   * cost signal available: nothing here has a price table, and half the models
   * in use are self-hosted under `cavi/`, so deriving cost from tokens
   * downstream would silently invent numbers for them. Absent when the proxy
   * does not send the header.
   */
  costUsd?: number;
}

export interface ChatOptions {
  role?: ModelRole;
  /**
   * `null` omits the field entirely. Some models accept only their default —
   * `claude-sonnet-5` answers 400 to anything but 1 — and the talk-back
   * container sends none, so an evaluation that wants to sample the same
   * distribution the drive did has to be able to send none too.
   */
  temperature?: number | null;
  maxTokens?: number;
  /** Requests reproducible sampling where the backend supports it. */
  seed?: number;
  /** Ask the backend for a JSON object. Support varies by model. */
  json?: boolean;
  signal?: AbortSignal;
  /**
   * Forwarded to LiteLLM as `metadata`, which it hands to its logging
   * callbacks. With Langfuse configured on the proxy, `session_id`, `tags`,
   * `trace_id`, `generation_name` and `version` are read from here. Ignored
   * by a proxy without callbacks; never reaches the upstream model.
   */
  metadata?: Record<string, unknown>;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Chat completion via LiteLLM's OpenAI-compatible `/chat/completions`. */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const { baseUrl, apiKey } = litellmConfig();
  const endpoint = `${baseUrl}/chat/completions`;
  const requestedModel = modelFor(options.role ?? "fast");

  const startedAt = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: requestedModel,
      messages,
      ...(options.temperature === null ? {} : { temperature: options.temperature ?? 0.2 }),
      ...(options.metadata ? { metadata: options.metadata } : {}),
      // Backends disagree about which parameters they accept — Anthropic
      // rejects `seed` outright with a 400, which is non-retryable and would
      // permanently poison every extraction routed to it. Letting LiteLLM drop
      // what a provider cannot use keeps one set of options working across all
      // of them. Determinism does not depend on `seed` anyway: it comes from
      // the persisted extraction cache, which replays without calling out.
      drop_params: true,
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: options.signal,
  });
  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    throw new LiteLLMError(res.status, await res.text(), "/chat/completions");
  }

  const json = (await res.json()) as ChatCompletionResponse;

  return {
    content: json.choices?.[0]?.message?.content ?? "",
    costUsd: parseCostHeader(res.headers.get("x-litellm-response-cost")),
    // Fall back to the requested name rather than empty: a backend that omits
    // `model` should still leave a usable provenance record.
    resolvedModel: json.model ?? requestedModel,
    requestedModel,
    usage: {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    },
    latencyMs,
  };
}
