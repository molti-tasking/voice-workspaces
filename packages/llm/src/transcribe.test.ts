import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiteLLMError } from "./config";
import { transcribeChunk } from "./transcribe";

const AUDIO = new Uint8Array([1, 2, 3, 4]);
const OPTS = { filename: "0.webm", mimeType: "audio/webm" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  process.env.LITELLM_BASE_URL = "https://litellm.test/v1";
  process.env.LITELLM_API_KEY = "sk-test";
  process.env.MODEL_TRANSCRIBE = "whisper-1";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("transcribeChunk", () => {
  it("returns chunk-relative segments verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          text: "one two",
          duration: 4,
          segments: [
            { start: 0, end: 2, text: "one" },
            { start: 2, end: 4, text: "two" },
          ],
        }),
      ),
    );

    const result = await transcribeChunk(AUDIO, OPTS);
    expect(result.segments).toEqual([
      { start: 0, end: 2, text: "one" },
      { start: 2, end: 4, text: "two" },
    ]);
    expect(result.text).toBe("one two");
  });

  it("falls back to one whole-chunk segment when the backend ignores verbose_json", async () => {
    // Degraded (chunk-level) provenance still beats dropping the audio: not
    // every LiteLLM backend honours verbose_json.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ text: "no segments here", duration: 9 })),
    );

    const result = await transcribeChunk(AUDIO, OPTS);
    expect(result.segments).toEqual([{ start: 0, end: 9, text: "no segments here" }]);
  });

  it("returns no segments for silence rather than an empty-text segment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ text: "   " })));

    const result = await transcribeChunk(AUDIO, OPTS);
    expect(result.segments).toEqual([]);
    expect(result.text).toBe("");
  });

  it("sends the model, verbose_json and the audio as multipart", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "", segments: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeChunk(AUDIO, { ...OPTS, prompt: "previous words" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://litellm.test/v1/audio/transcriptions");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("prompt")).toBe("previous words");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("uploads exactly the chunk's bytes", async () => {
    // Guards the Buffer-pool hazard: a Uint8Array view over a pooled Node
    // Buffer can otherwise carry the whole slab into the upload.
    const pooled = Buffer.allocUnsafe(8192);
    const view = new Uint8Array(pooled.buffer, pooled.byteOffset, 4);

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "", segments: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeChunk(view, OPTS);

    const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect((form.get("file") as Blob).size).toBe(4);
  });

  it("raises a retryable error for 429 and 5xx", async () => {
    for (const status of [429, 500, 503]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream", { status })));
      const err = await transcribeChunk(AUDIO, OPTS).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LiteLLMError);
      expect((err as LiteLLMError).retryable).toBe(true);
    }
  });

  it("raises a non-retryable error for a 400", async () => {
    // Retrying a malformed request forever would wedge the queue behind it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad audio", { status: 400 })));
    const err = await transcribeChunk(AUDIO, OPTS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiteLLMError);
    expect((err as LiteLLMError).retryable).toBe(false);
  });

  it("strips a trailing slash from the configured base URL", async () => {
    process.env.LITELLM_BASE_URL = "https://litellm.test/v1/";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ text: "", segments: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeChunk(AUDIO, OPTS);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://litellm.test/v1/audio/transcriptions");
  });
});
