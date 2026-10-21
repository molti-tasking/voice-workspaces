import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkLiteLLM } from "./health";

beforeEach(() => {
  process.env.LITELLM_BASE_URL = "https://litellm.test";
  process.env.LITELLM_API_KEY = "sk-test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(status: number, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(new Response(null, { status, headers }));
}

describe("whether the AI proxy can be used", () => {
  it("is ok when the models list answers, asked with the key and without following redirects", async () => {
    const fetchMock = answer(200);
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkLiteLLM()).toMatchObject({ status: "ok" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://litellm.test/models");
    expect(init).toMatchObject({ redirect: "manual", headers: { Authorization: "Bearer sk-test" } });
  });

  it("says where it moved, because a redirect to another host loses the key", async () => {
    vi.stubGlobal("fetch", answer(308, { location: "https://ai.example.org/models" }));
    expect(await checkLiteLLM()).toMatchObject({ status: "moved", movedTo: "https://ai.example.org" });
  });

  it("tells a refused key from a broken server and from no answer at all", async () => {
    vi.stubGlobal("fetch", answer(401));
    expect((await checkLiteLLM()).status).toBe("unauthorized");
    vi.stubGlobal("fetch", answer(502));
    expect(await checkLiteLLM()).toMatchObject({ status: "error", httpStatus: 502 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect((await checkLiteLLM()).status).toBe("unreachable");
  });

  it("says when there is nothing to ask", async () => {
    delete process.env.LITELLM_BASE_URL;
    expect((await checkLiteLLM()).status).toBe("unconfigured");
  });
});
