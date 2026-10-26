import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiteLLMError } from "./config";
import { mintRealtimeSecret, type RealtimeSessionConfig } from "./realtime";

const SESSION: RealtimeSessionConfig = {
  type: "realtime",
  model: "openai/gpt-realtime-2.1",
  instructions: "Talk.",
  audio: {
    input: { transcription: { model: "gpt-4o-transcribe" }, turn_detection: { type: "semantic_vad", eagerness: "auto" } },
    output: { voice: "marin" },
  },
};

function answer(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

beforeEach(() => {
  process.env.LITELLM_BASE_URL = "https://litellm.test/";
  process.env.LITELLM_API_KEY = "sk-test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mintRealtimeSecret", () => {
  it("posts the session with the proxy key and hands back the secret, never the key", async () => {
    const fetch = vi.fn().mockResolvedValue(
      answer({ value: "ek_abc", expires_at: 1_793_050_505, session: { model: "gpt-realtime-2.1" } }),
    );
    vi.stubGlobal("fetch", fetch);

    const secret = await mintRealtimeSecret(SESSION);

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://litellm.test/realtime/client_secrets");
    expect(init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body)).toEqual({ model: "openai/gpt-realtime-2.1", session: SESSION });
    expect(secret).toEqual({
      value: "ek_abc",
      expiresAt: 1_793_050_505_000,
      resolvedModel: "gpt-realtime-2.1",
      callsUrl: "https://litellm.test/realtime/calls",
    });
    expect(JSON.stringify(secret)).not.toContain("sk-test");
  });

  it("carries the proxy's own words when it refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer('{"error":"model not supported in realtime mode"}', 400)));

    const err = await mintRealtimeSecret(SESSION).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LiteLLMError);
    expect((err as LiteLLMError).status).toBe(400);
    expect((err as LiteLLMError).message).toContain("not supported in realtime mode");
  });

  it("refuses an answer that carries no secret", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer({ session: {} })));
    await expect(mintRealtimeSecret(SESSION)).rejects.toBeInstanceOf(LiteLLMError);
  });
});
