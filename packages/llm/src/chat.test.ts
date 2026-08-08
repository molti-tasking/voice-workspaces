import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chat } from "./chat";
import { LiteLLMError } from "./config";

/**
 * The response envelope is provenance, not decoration: a stored extraction is
 * only worth anything if it records which model answered and what it cost.
 * These pin the parts that would otherwise fail silently as zeros.
 */

function completion(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const FULL = {
  model: "anthropic/claude-sonnet-5-resolved",
  choices: [{ message: { content: "hello" } }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
};

beforeEach(() => {
  process.env.LITELLM_BASE_URL = "https://litellm.test/v1";
  process.env.LITELLM_API_KEY = "sk-test";
  process.env.MODEL_FAST = "cavi/gemma3:12b";
  process.env.MODEL_REASONING = "anthropic/claude-sonnet-5";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat", () => {
  it("returns content, usage and the resolved model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion(FULL)));

    const result = await chat([{ role: "user", content: "hi" }], { role: "reasoning" });

    expect(result.content).toBe("hello");
    expect(result.usage).toEqual({
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("distinguishes the resolved model from the requested one", async () => {
    // LiteLLM aliases, wildcards and fallbacks mean these genuinely differ, and
    // only the resolved name is true provenance.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion(FULL)));

    const result = await chat([{ role: "user", content: "hi" }], { role: "reasoning" });

    expect(result.requestedModel).toBe("anthropic/claude-sonnet-5");
    expect(result.resolvedModel).toBe("anthropic/claude-sonnet-5-resolved");
  });

  it("falls back to the requested model when the backend omits one", async () => {
    // Better a usable provenance record than an empty string.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(completion({ choices: [{ message: { content: "x" } }] })),
    );

    const result = await chat([{ role: "user", content: "hi" }], { role: "fast" });
    expect(result.resolvedModel).toBe("cavi/gemma3:12b");
  });

  it("reports zero tokens rather than throwing when usage is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(completion({ choices: [{ message: { content: "x" } }] })),
    );

    const result = await chat([{ role: "user", content: "hi" }]);
    expect(result.usage.totalTokens).toBe(0);
  });

  it("sends temperature and seed so a forced re-run is reproducible", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion(FULL));
    vi.stubGlobal("fetch", fetchMock);

    await chat([{ role: "user", content: "hi" }], {
      role: "reasoning",
      temperature: 0,
      seed: 7,
      json: true,
    });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.temperature).toBe(0);
    expect(body.seed).toBe(7);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("anthropic/claude-sonnet-5");
  });

  it("always sends drop_params, so an unsupported option cannot 400", () => {
    // Anthropic rejects `seed` outright, and a 400 is non-retryable — it would
    // permanently poison every extraction routed there.
    const fetchMock = vi.fn().mockResolvedValue(completion(FULL));
    vi.stubGlobal("fetch", fetchMock);

    return chat([{ role: "user", content: "hi" }], { seed: 7 }).then(() => {
      const body = JSON.parse(
        (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
      );
      expect(body.drop_params).toBe(true);
    });
  });

  it("omits seed entirely when not asked for", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion(FULL));
    vi.stubGlobal("fetch", fetchMock);

    await chat([{ role: "user", content: "hi" }]);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect("seed" in body).toBe(false);
  });

  it("returns empty content rather than undefined when there are no choices", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(completion({ choices: [] })));
    expect((await chat([{ role: "user", content: "hi" }])).content).toBe("");
  });

  it("raises a retryable error for 429 and 5xx", async () => {
    for (const status of [429, 503]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream", { status })));
      const err = await chat([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LiteLLMError);
      expect((err as LiteLLMError).retryable).toBe(true);
    }
  });

  it("raises a non-retryable error for a 400", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));
    const err = await chat([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect((err as LiteLLMError).retryable).toBe(false);
  });
});
