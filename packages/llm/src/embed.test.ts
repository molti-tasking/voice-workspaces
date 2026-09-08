import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiteLLMError } from "./config";
import { embed, hasEmbeddings } from "./embed";

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.LITELLM_BASE_URL = "https://litellm.test/v1";
  process.env.LITELLM_API_KEY = "sk-test";
  process.env.MODEL_EMBED = "cavi/nomic-embed-text";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MODEL_EMBED;
});

describe("embed", () => {
  it("is optional: without MODEL_EMBED there is no index", () => {
    expect(hasEmbeddings()).toBe(true);
    delete process.env.MODEL_EMBED;
    expect(hasEmbeddings()).toBe(false);
  });

  it("returns vectors in input order even when the API reorders them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          model: "nomic-embed-text-v1.5",
          data: [
            { index: 1, embedding: [0.2, 0.2] },
            { index: 0, embedding: [0.1, 0.1] },
          ],
          usage: { prompt_tokens: 9 },
        }),
      ),
    );
    const result = await embed(["a", "b"]);
    expect(result.vectors).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
    ]);
    expect(result.dimensions).toBe(2);
    expect(result.resolvedModel).toBe("nomic-embed-text-v1.5");
    expect(result.requestedModel).toBe("cavi/nomic-embed-text");
    expect(result.promptTokens).toBe(9);
  });

  it("makes no call for an empty batch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await embed([]);
    expect(result.vectors).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a short or ragged response rather than storing holes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ data: [{ embedding: [1] }] })));
    await expect(embed(["a", "b"])).rejects.toThrow(/asked for 2/);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ data: [{ embedding: [1, 2] }, { embedding: [1] }] })),
    );
    await expect(embed(["a", "b"])).rejects.toThrow(/mixed dimension/);
  });

  it("raises LiteLLMError on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "nope" }, 503)));
    await expect(embed(["a"])).rejects.toBeInstanceOf(LiteLLMError);
  });
});
