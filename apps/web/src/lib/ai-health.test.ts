import { describe, expect, it } from "vitest";
import { aiHealthProblem } from "./ai-health";

const at = "2026-10-21T10:00:00.000Z";

describe("what the recorder says about the AI server", () => {
  it("says nothing before the first answer, or when it works", () => {
    expect(aiHealthProblem(null)).toBeNull();
    expect(aiHealthProblem({ status: "ok", latencyMs: 180, checkedAt: at })).toBeNull();
  });

  it("names the fix for each way it can fail", () => {
    expect(aiHealthProblem({ status: "moved", movedTo: "https://ai.cavi.au.dk", checkedAt: at })).toBe(
      "The AI server has moved to ai.cavi.au.dk: update LITELLM_BASE_URL.",
    );
    expect(aiHealthProblem({ status: "unauthorized", checkedAt: at })).toMatch(/LITELLM_API_KEY/);
    expect(aiHealthProblem({ status: "error", httpStatus: 502, checkedAt: at })).toMatch(/HTTP 502/);
    expect(aiHealthProblem({ status: "unreachable", checkedAt: at })).toMatch(/not answering/);
    expect(aiHealthProblem({ status: "unconfigured", checkedAt: at })).toMatch(/LITELLM_BASE_URL/);
  });
});
