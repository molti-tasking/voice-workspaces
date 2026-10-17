import { describe, expect, it } from "vitest";
import { LiteLLMError } from "./config";

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

  it("does NOT retry an undecodable file dressed as a 415", () => {
    // The proxy now reports the same decode failure as a 415 rather than a 500.
    const body =
      '{"error":{"message":"litellm.APIError: APIError: OpenAIException - ' +
      "Error code: 415 - {'detail': 'Failed to decode audio. The provided " +
      "file type is not supported.'}\"}}";
    expect(at(415, body)).toBe(false);
  });

  it("does NOT retry a decode failure whatever status rides in front of it", () => {
    // The cause is read before the status, so even a would-be-retryable code
    // cannot turn an undecodable file into a retry storm.
    expect(at(429, "Failed to decode audio")).toBe(false);
    expect(at(503, "unsupported audio format")).toBe(false);
  });
});
