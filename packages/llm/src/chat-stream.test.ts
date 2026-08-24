import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatStream, type ChatStreamEvent, type ChatStreamResult } from "./chat-stream";

/**
 * These pin the failures that are silent rather than loud.
 *
 * An SSE parser that mishandles a chunk boundary does not throw — it drops a
 * few words out of a spoken reply, which nobody notices until a participant
 * says the system talks strangely. Likewise a tool call whose arguments span
 * five chunks either assembles or quietly becomes `{}`. Every case below has
 * been chosen because getting it wrong produces working-looking output.
 */

const encoder = new TextEncoder();

/** An SSE response whose byte chunks split exactly where `parts` says. */
function sse(parts: string[], headers: Record<string, string> = {}) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream", ...headers } },
  );
}

const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const textDelta = (s: string) => data({ model: "cavi/converse-resolved", choices: [{ delta: { content: s } }] });

async function drain(gen: AsyncGenerator<ChatStreamEvent>): Promise<{
  text: string;
  result: ChatStreamResult;
  events: ChatStreamEvent[];
}> {
  let text = "";
  let result: ChatStreamResult | undefined;
  const events: ChatStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
    if (event.type === "text") text += event.delta;
    if (event.type === "done") result = event.result;
  }
  if (!result) throw new Error("stream ended without a done event");
  return { text, result, events };
}

/** Indexed access under `noUncheckedIndexedAccess`, asserting rather than `!`. */
function at<T>(items: T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`expected an element at index ${index}`);
  return value;
}

beforeEach(() => {
  process.env.LITELLM_BASE_URL = "https://litellm.test/v1";
  process.env.LITELLM_API_KEY = "sk-test";
  process.env.MODEL_CONVERSE = "cavi/converse";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SSE framing", () => {
  it("reassembles an event split mid-`data:` line", async () => {
    // TCP puts chunk boundaries wherever it likes, routinely inside a line.
    // Parsing each read independently loses whatever straddled the seam.
    const full = textDelta("hello world");
    const cut = Math.floor(full.length / 2);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([full.slice(0, cut), full.slice(cut), "data: [DONE]\n\n"])));

    const { text } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(text).toBe("hello world");
  });

  it("reassembles a multi-byte character split across reads", async () => {
    // Rare in English, immediate the moment anyone speaks German or Danish —
    // which this corpus does. A naive decode yields U+FFFD here.
    const full = textDelta("Abgabefrist über Ø");
    const bytes = encoder.encode(full);
    // Cut inside the two-byte "ü" (0xC3 0xBC).
    const cut = bytes.indexOf(0xc3) + 1;
    const chunks = [bytes.slice(0, cut), bytes.slice(cut)];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk);
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const { text } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(text).toBe("Abgabefrist über Ø");
    expect(text).not.toContain("�");
  });

  it("handles several events arriving in one read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sse([textDelta("a") + textDelta("b") + textDelta("c"), "data: [DONE]\n\n"])),
    );

    const { text } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(text).toBe("abc");
  });

  it("accepts CRLF framing", async () => {
    const crlf = `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\r\n\r\n`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([crlf, "data: [DONE]\r\n\r\n"])));

    const { text } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(text).toBe("ok");
  });

  it("skips unparseable frames instead of killing the conversation", async () => {
    // A keep-alive comment or a truncated frame must not end a turn in progress.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sse([textDelta("a"), ": keep-alive\n\n", "data: {not json\n\n", textDelta("b")])),
    );

    const { text } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(text).toBe("ab");
  });
});

describe("provenance", () => {
  it("takes the resolved model from the first chunk", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([textDelta("x"), "data: [DONE]\n\n"])));

    const { result } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(result.requestedModel).toBe("cavi/converse");
    expect(result.resolvedModel).toBe("cavi/converse-resolved");
  });

  it("falls back to the requested model when the backend omits one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sse([data({ choices: [{ delta: { content: "x" } }] }), "data: [DONE]\n\n"])),
    );

    const { result } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(result.resolvedModel).toBe("cavi/converse");
  });

  it("reads usage from the final usage-only chunk", async () => {
    // stream_options.include_usage emits a chunk with empty `choices` — the only
    // place token counts appear on a streamed call.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([
          textDelta("hi"),
          data({ choices: [], usage: { prompt_tokens: 53, completion_tokens: 14, total_tokens: 67 } }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const { result } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(result.usage).toEqual({ promptTokens: 53, completionTokens: 14, totalTokens: 67 });
  });

  it("leaves costUsd undefined when the header is absent", async () => {
    // Confirmed absent on streamed calls against the real proxy. A zero would be
    // indistinguishable from a genuinely free self-hosted call and would drag any
    // cost average towards nothing — and deriving it from tokens would invent a
    // number for models that have no price table at all.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([textDelta("x"), "data: [DONE]\n\n"])));

    const { result } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(result.costUsd).toBeUndefined();
  });

  it("reports ttft from the first content delta, not the last", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([textDelta("a"), textDelta("b"), "data: [DONE]\n\n"])));

    const { result } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(result.ttftMs).toBeDefined();
    expect(result.ttftMs ?? Infinity).toBeLessThanOrEqual(result.latencyMs);
  });
});

describe("tool calls", () => {
  const toolDelta = (index: number, fields: Record<string, unknown>) =>
    data({ choices: [{ delta: { tool_calls: [{ index, ...fields }] } }] });

  it("assembles arguments split across many chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([
          toolDelta(0, { id: "call_1", function: { name: "search_transcript", arguments: '{"qu' } }),
          toolDelta(0, { function: { arguments: 'ery":"dead' } }),
          toolDelta(0, { function: { arguments: 'line"' } }),
          toolDelta(0, { function: { arguments: "}" } }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const { result } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(result.toolCalls).toHaveLength(1);
    expect(at(result.toolCalls, 0).name).toBe("search_transcript");
    expect(at(result.toolCalls, 0).arguments).toEqual({ query: "deadline" });
    expect(at(result.toolCalls, 0).parseError).toBeUndefined();
  });

  it("keeps interleaved calls separate and in index order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([
          toolDelta(0, { id: "a", function: { name: "search_transcript", arguments: '{"query":' } }),
          toolDelta(1, { id: "b", function: { name: "web_search", arguments: '{"query":' } }),
          toolDelta(1, { function: { arguments: '"b"}' } }),
          toolDelta(0, { function: { arguments: '"a"}' } }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const { result } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(result.toolCalls.map((t) => t.name)).toEqual(["search_transcript", "web_search"]);
    expect(at(result.toolCalls, 0).arguments).toEqual({ query: "a" });
    expect(at(result.toolCalls, 1).arguments).toEqual({ query: "b" });
  });

  it("records a parse error instead of throwing on malformed arguments", async () => {
    // A malformed tool call must degrade to "the model said something odd" and
    // let the turn continue — not crash a conversation happening at 110 km/h.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([toolDelta(0, { id: "a", function: { name: "mark", arguments: "{not json" } }), "data: [DONE]\n\n"]),
      ),
    );

    const { result } = await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(at(result.toolCalls, 0).parseError).toBeDefined();
    expect(at(result.toolCalls, 0).arguments).toEqual({});
    // The raw string survives, so the failure is diagnosable after the fact.
    expect(at(result.toolCalls, 0).rawArguments).toBe("{not json");
  });

  it("announces a tool call as soon as its name is known", async () => {
    // The UI shows "looking that up" and the agent speaks an announcement well
    // before the arguments have finished arriving.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sse([
          toolDelta(0, { id: "a", function: { name: "web_search" } }),
          toolDelta(0, { function: { arguments: '{"query":"x"}' } }),
          "data: [DONE]\n\n",
        ]),
      ),
    );

    const { events } = await drain(chatStream([{ role: "user", content: "hi" }]));
    const starts = events.filter((e) => e.type === "tool_call_start");
    expect(starts).toHaveLength(1);
    expect(at(starts, 0).name).toBe("web_search");
  });
});

describe("request shape", () => {
  it("sends stream and include_usage, and tools only when given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([textDelta("x"), "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);

    await drain(chatStream([{ role: "user", content: "hi" }]));
    const body = JSON.parse(at(fetchMock.mock.calls, 0)[1].body as string);

    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    // Kept for the same reason chat.ts keeps it: backends disagree about which
    // parameters they accept, and stream_options is exactly what an older one
    // would reject outright.
    expect(body.drop_params).toBe(true);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("defaults to the converse role, not fast", async () => {
    // MODEL_FAST is chosen for the workspace extractor, and gemma3:12b accepts
    // `tools` without erroring and then never calls one — an agent that silently
    // refuses to look anything up.
    process.env.MODEL_FAST = "cavi/gemma3:12b";
    const fetchMock = vi.fn().mockResolvedValue(sse([textDelta("x"), "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);

    await drain(chatStream([{ role: "user", content: "hi" }]));
    expect(JSON.parse(at(fetchMock.mock.calls, 0)[1].body as string).model).toBe("cavi/converse");
  });
});
