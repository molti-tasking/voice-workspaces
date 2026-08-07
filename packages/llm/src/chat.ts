import { LiteLLMError, litellmConfig, modelFor, type ModelRole } from "./config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  role?: ModelRole;
  temperature?: number;
  maxTokens?: number;
  /** Ask the backend for a JSON object. Support varies by model. */
  json?: boolean;
  signal?: AbortSignal;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/** Chat completion via LiteLLM's OpenAI-compatible `/chat/completions`. */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const { baseUrl, apiKey } = litellmConfig();
  const endpoint = `${baseUrl}/chat/completions`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelFor(options.role ?? "fast"),
      messages,
      temperature: options.temperature ?? 0.2,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    throw new LiteLLMError(res.status, await res.text(), "/chat/completions");
  }

  const json = (await res.json()) as ChatCompletionResponse;
  return json.choices?.[0]?.message?.content ?? "";
}
