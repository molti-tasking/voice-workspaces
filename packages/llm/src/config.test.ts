import { describe, expect, it } from "vitest";
import { LiteLLMError, modelFor } from "./config";

describe("LiteLLMError.retryable", () => {
  const at = (status: number, body: string) =>
    new LiteLLMError(status, body, "/audio/transcriptions").retryable;

  it("retries a genuine server error", () => {
    expect(at(500, "upstream connect error")).toBe(true);
    expect(at(503, "service unavailable")).toBe(true);
    expect(at(429, "rate limited")).toBe(true);
  });

  it("does not retry a request we will keep getting wrong", () => {
    expect(at(400, "bad request")).toBe(false);
    expect(at(401, "unauthorised")).toBe(false);
  });

  it("does NOT retry undecodable audio, even dressed as a 500", () => {
    // Verbatim from a real drive. This chunk retried for four hours, on the
    // same GPU the live conversation was waiting for.
    const body =
      '{"error":{"message":"litellm.InternalServerError: InternalServerError: ' +
      "OpenAIException - Error code: 500 - {'detail': 'Failed to decode audio.'}. " +
      'Received Model Group=cavi/faster-whisper-large-v3","code":"500"}}';
    expect(at(500, body)).toBe(false);
  });

  it("still retries a 500 that merely mentions audio in passing", () => {
    expect(at(500, "audio backend timed out")).toBe(true);
  });
});

describe("the judge's model", () => {
  it("is MODEL_JUDGE, or the fast model when that is unset", () => {
    const saved = { judge: process.env.MODEL_JUDGE, fast: process.env.MODEL_FAST };
    try {
      process.env.MODEL_FAST = "cavi/gemma3:12b";
      delete process.env.MODEL_JUDGE;
      expect(modelFor("judge")).toBe("cavi/gemma3:12b");
      process.env.MODEL_JUDGE = "cavi/qwen3:32b";
      expect(modelFor("judge")).toBe("cavi/qwen3:32b");
    } finally {
      for (const [key, value] of [["MODEL_JUDGE", saved.judge], ["MODEL_FAST", saved.fast]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
