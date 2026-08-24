import type { ChatMessage, ChatOptions, TokenUsage } from "./chat";
import { LiteLLMError, litellmConfig, modelFor } from "./config";
import { emitGeneration, type GenerationContext } from "./observe";

/**
 * Streaming chat completion, for the live conversation.
 *
 * `chat()` is the right shape for the workspace extractor: one request, one JSON
 * object, cached by content hash and replayable. A spoken conversation is the
 * opposite — nothing is replayable, and the only number that matters is how
 * soon the first word can be spoken. So this streams, reports `ttftMs`, and
 * assembles tool calls.
 *
 * Kept as a separate module rather than an option on `chat()` because the return
 * type is genuinely different (an async generator, not a value) and because the
 * extraction path must not accidentally acquire a streaming code path it would
 * then have to cache.
 */

/** A tool the model may call. `parameters` is JSON Schema — use z.toJSONSchema(). */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AssembledToolCall {
  id: string;
  name: string;
  /** Parsed arguments, or `{}` when the model emitted invalid JSON. */
  arguments: Record<string, unknown>;
  /** The raw string, kept so a parse failure is diagnosable rather than lost. */
  rawArguments: string;
  /**
   * Set when `rawArguments` would not parse.
   *
   * Recorded rather than thrown: a malformed tool call must degrade to "the
   * model said something odd" and let the turn continue, not crash a
   * conversation happening at 110 km/h.
   */
  parseError?: string;
}

export interface ChatStreamResult {
  content: string;
  toolCalls: AssembledToolCall[];
  requestedModel: string;
  resolvedModel: string;
  usage: TokenUsage;
  /**
   * Time to the first content or tool-call delta.
   *
   * The headline latency number for talk-back, and available nowhere else — a
   * non-streaming call cannot measure it, and total latency hides it.
   */
  ttftMs?: number;
  latencyMs: number;
  finishReason?: string;
  /**
   * Almost always undefined on a streamed call.
   *
   * `x-litellm-response-cost` is a response HEADER, and the proxy cannot know
   * the cost when headers are sent — confirmed absent in the spike. Never derive
   * a cost from token counts to fill the gap: half the models here are
   * self-hosted under `cavi/` with no price table, so a derived number would be
   * fiction. Undefined is the honest answer.
   */
  costUsd?: number;
}

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call_start"; index: number; name: string }
  | { type: "done"; result: ChatStreamResult };

interface StreamChunk {
  model?: string;
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Undefined rather than 0: a zero is indistinguishable from a free call. */
function parseCostHeader(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Split an SSE byte stream into events.
 *
 * Two things here are not optional, and both fail silently when got wrong:
 *
 * - **Buffer across reads.** A network chunk boundary lands wherever TCP puts
 *   it, routinely mid-`data:` line. Parsing each read independently drops
 *   whatever straddled the seam — which shows up as occasional missing words in
 *   a reply, not as an error.
 * - **Decode with `{ stream: true }`.** A multi-byte character split across two
 *   reads decodes to a replacement character otherwise. Rare in English, common
 *   the moment anyone speaks German or Danish, which this corpus does.
 */
async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      // Servers may use \n\n or \r\n\r\n; handle both rather than assuming.
      while ((sep = findEventBoundary(buffer)) !== -1) {
        const [end, skip] = [sep, buffer.startsWith("\r\n\r\n", sep) ? 4 : 2];
        yield buffer.slice(0, end);
        buffer = buffer.slice(end + skip);
      }
    }
    // A final event with no trailing blank line still carries data.
    if (buffer.trim()) yield buffer;
  } finally {
    // Releases the socket on abort/early-return, so a barge-in actually stops
    // the backend generating instead of leaving it running to completion.
    reader.cancel().catch(() => {});
  }
}

function findEventBoundary(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

export async function* chatStream(
  messages: ChatMessage[],
  options: ChatOptions & {
    tools?: ToolSpec[];
    toolChoice?: "auto" | "none" | "required";
    /**
     * Turn off extended reasoning.
     *
     * Worth doing for anything spoken. A reasoning model spends its budget
     * thinking BEFORE it emits any text, which costs two things in a live
     * conversation: about 1.4 seconds of measured latency per turn, and — far
     * worse — a truncation trap. With a `maxTokens` sized for a one-sentence
     * spoken reply, the whole budget goes to reasoning and the response comes
     * back `finish_reason: "length"` with ZERO characters of text. That reads
     * downstream as the model declining to speak, so the agent simply goes mute
     * with nothing in the logs to explain it. This cost a real debugging session.
     *
     * Dropped automatically by LiteLLM for models that do not support it, so it
     * is safe to send unconditionally.
     */
    disableThinking?: boolean;
  } = {},
): AsyncGenerator<ChatStreamEvent> {
  const { baseUrl, apiKey } = litellmConfig();
  const endpoint = `${baseUrl}/chat/completions`;
  const requestedModel = modelFor(options.role ?? "converse");

  const context: GenerationContext = {};
  const startedAt = Date.now();

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: requestedModel,
      messages,
      stream: true,
      // Verified present on this proxy: without it a streamed call reports no
      // usage at all and every agent_turn row loses its token counts.
      stream_options: { include_usage: true },
      temperature: options.temperature ?? 0.4,
      // Same reasoning as chat.ts: backends disagree about which parameters
      // they accept, and stream_options is exactly the kind of thing an older
      // one rejects outright.
      drop_params: true,
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.disableThinking ? { thinking: { type: "disabled" } } : {}),
      ...(options.tools?.length
        ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" }
        : {}),
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    emitGeneration({
      spanName: "talkback_reply",
      model: requestedModel,
      latencyMs: Date.now() - startedAt,
      context,
      input: messages,
      httpStatus: res.status,
      error: body.slice(0, 500),
    });
    throw new LiteLLMError(res.status, body, "/chat/completions");
  }
  if (!res.body) {
    throw new LiteLLMError(res.status, "no response body", "/chat/completions");
  }

  let content = "";
  let ttftMs: number | undefined;
  let resolvedModel: string | undefined;
  let finishReason: string | undefined;
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  /* Tool calls arrive as fragments keyed by `index`, with `arguments` split
   * across arbitrarily many chunks — a single argument object routinely spans
   * five or more. Accumulate by index and parse once at the end. */
  const partial = new Map<number, { id: string; name: string; args: string }>();
  const announced = new Set<number>();

  try {
    for await (const event of readSseEvents(res.body)) {
      for (const line of event.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;

        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(payload) as StreamChunk;
        } catch {
          // A keep-alive comment or a truncated frame. Skipping is correct —
          // throwing would kill a live conversation over a stray byte.
          continue;
        }

        // The first chunk carries the true model name. Same doctrine as
        // chat.ts: aliases, wildcards and fallbacks all mean the requested name
        // is not provenance.
        resolvedModel ??= chunk.model;

        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }

        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;

        const delta = choice?.delta;
        if (delta?.content) {
          ttftMs ??= Date.now() - startedAt;
          content += delta.content;
          yield { type: "text", delta: delta.content };
        }

        for (const tc of delta?.tool_calls ?? []) {
          ttftMs ??= Date.now() - startedAt;
          const slot = partial.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) slot.id += tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          partial.set(tc.index, slot);

          // Surface the intent as soon as the name is known, so the UI can show
          // "looking that up" and the agent can announce it — well before the
          // arguments have finished arriving.
          if (slot.name && !announced.has(tc.index)) {
            announced.add(tc.index);
            yield { type: "tool_call_start", index: tc.index, name: slot.name };
          }
        }
      }
    }
  } catch (err) {
    emitGeneration({
      spanName: "talkback_reply",
      model: requestedModel,
      latencyMs: Date.now() - startedAt,
      context,
      input: messages,
      output: content,
      error: err instanceof Error ? err.message : String(err),
      properties: { ttft_ms: ttftMs, aborted: options.signal?.aborted ?? false },
    });
    throw err;
  }

  const toolCalls: AssembledToolCall[] = [...partial.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, slot]) => {
      const raw = slot.args.trim();
      if (!raw) return { id: slot.id, name: slot.name, arguments: {}, rawArguments: "" };
      try {
        const parsed = JSON.parse(raw) as unknown;
        return {
          id: slot.id,
          name: slot.name,
          arguments:
            parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : {},
          rawArguments: raw,
        };
      } catch (err) {
        return {
          id: slot.id,
          name: slot.name,
          arguments: {},
          rawArguments: raw,
          parseError: err instanceof Error ? err.message : String(err),
        };
      }
    });

  if (finishReason === "length" && !content) {
    // Every token went to reasoning and none to speech. Silent otherwise, and
    // indistinguishable from a model that chose to say nothing.
    emitGeneration({
      spanName: "talkback_reply",
      model: resolvedModel ?? requestedModel,
      latencyMs: Date.now() - startedAt,
      context,
      input: messages,
      error: "truncated before any text — raise maxTokens or set disableThinking",
      properties: { finish_reason: finishReason, completion_tokens: usage.completionTokens },
    });
  }

  const latencyMs = Date.now() - startedAt;
  const result: ChatStreamResult = {
    content,
    toolCalls,
    requestedModel,
    resolvedModel: resolvedModel ?? requestedModel,
    usage,
    ttftMs,
    latencyMs,
    finishReason,
    costUsd: parseCostHeader(res.headers.get("x-litellm-response-cost")),
  };

  emitGeneration({
    spanName: "talkback_reply",
    model: result.resolvedModel,
    latencyMs,
    context,
    input: messages,
    output: content,
    httpStatus: res.status,
    costUsd: result.costUsd,
    properties: {
      ttft_ms: ttftMs,
      tool_calls: toolCalls.map((t) => t.name),
      tool_parse_errors: toolCalls.filter((t) => t.parseError).length,
      finish_reason: finishReason,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
    },
  });

  yield { type: "done", result };
}
