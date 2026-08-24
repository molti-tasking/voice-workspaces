import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiteLLMError } from "./config";
import { findSpeechGaps, speak, splitForSpeech } from "./speak";

/**
 * Two things here are load-bearing and would fail silently.
 *
 * `speak()` must return before the body has finished arriving — buffering it
 * would be invisible in every test that only checks the bytes, while adding the
 * whole synthesis time to every spoken reply.
 *
 * `splitForSpeech` decides time-to-first-audio outright: the measured backend
 * costs ~12.5ms per character with almost no fixed cost, so a 90-character
 * "short sentence" is over a second of silence before the agent says anything.
 */

/** Indexed access under `noUncheckedIndexedAccess`, asserting rather than `!`. */
function at<T>(items: T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`expected an element at index ${index}`);
  return value;
}

beforeEach(() => {
  process.env.LITELLM_BASE_URL = "https://litellm.test/v1";
  process.env.LITELLM_API_KEY = "sk-test";
  process.env.MODEL_SPEAK = "cavi/piper-en_US-ryan-high";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** An audio response whose body stays open until `release()` is called. */
function pendingAudio(headers: Record<string, string> = {}) {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      await opened;
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "Content-Type": "audio/mpeg", ...headers } }),
    release,
  };
}

describe("speak", () => {
  it("returns before the body finishes — it must not buffer", async () => {
    // The entire point of the function. Buffering would be invisible to a test
    // that only inspects the returned bytes, while silently adding full
    // synthesis time to every reply.
    const { response, release } = pendingAudio();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await speak("Right, so —");

    expect(result.stream).toBeInstanceOf(ReadableStream);
    // Resolved while the body is still open; releasing afterwards proves it.
    release();
  });

  it("reports the requested format, not the Content-Type header", async () => {
    // The proxy answers `audio/mpeg` whatever response_format was asked for,
    // while the bytes honour the request. Trusting the header would feed mp3
    // frames to a PCM ring buffer and play noise.
    const { response, release } = pendingAudio({ "Content-Type": "audio/mpeg" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await speak("hello", { format: "pcm" });

    expect(result.format).toBe("pcm");
    expect(result.contentType).toBe("audio/mpeg");
    release();
  });

  it("sends the speak model and omits voice when not given", async () => {
    // Piper bakes the voice into the model id, so a `voice` field is meaningless
    // — sending one invites a backend to reject the request outright.
    const { response, release } = pendingAudio();
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    await speak("hello");
    const body = JSON.parse(at(fetchMock.mock.calls, 0)[1].body as string);

    expect(body.model).toBe("cavi/piper-en_US-ryan-high");
    expect(body.input).toBe("hello");
    expect(body.response_format).toBe("wav");
    expect(body.voice).toBeUndefined();
    release();
  });

  it("leaves costUsd undefined when the header is absent", async () => {
    const { response, release } = pendingAudio();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await speak("hello");
    expect(result.costUsd).toBeUndefined();
    release();
  });

  it("throws LiteLLMError on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no such model", { status: 400 })));

    await expect(speak("hello")).rejects.toBeInstanceOf(LiteLLMError);
  });

  it("propagates an abort", async () => {
    // Barge-in cancels an in-flight synthesis; the rejection must surface so the
    // turn can be recorded as truncated rather than completed.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));

    await expect(speak("hello", { signal: AbortSignal.abort() })).rejects.toThrow();
  });
});

describe("splitForSpeech", () => {
  it("keeps the first chunk short enough to speak quickly", async () => {
    const reply =
      "Right, so what were you saying about the deadline? I think the point about scope is the one that matters.";
    const chunks = splitForSpeech(reply);

    // 40 chars is the target (~500ms at the measured 12.5ms/char), but the
    // minimum-chunk rule may overshoot it to avoid emitting a fragment that
    // would stall the next chunk. The hard ceiling is what is guaranteed.
    expect(at(chunks, 0).length).toBeLessThanOrEqual(80);
    expect(at(chunks, 0).length).toBeLessThan(reply.length / 2);
    expect(chunks.join(" ")).toContain("deadline");
  });

  it("splits on clause boundaries, not only sentence ends", async () => {
    // A single 98-character sentence with no full stop would otherwise be one
    // chunk — over a second of silence before the agent makes any sound.
    const oneSentence =
      "I think the thing you keep circling back to, the one about scope, is really the whole problem here";
    const chunks = splitForSpeech(oneSentence);

    expect(chunks.length).toBeGreaterThan(1);
    // The opening clause runs slightly past the soft limit and is kept whole:
    // cutting inside it is audible, and slightly late beats slightly chopped.
    expect(at(chunks, 0)).toBe("I think the thing you keep circling back to,");
  });

  it("cuts an over-long opening clause at a word boundary", async () => {
    // Preferring whole clauses is right, but unbounded it is not — a reply
    // opening with a 200-character subordinate clause would be ~2.5s of silence,
    // which reads as the system having failed.
    const rambling =
      "Well the thing about all of this is that the deadline you keep mentioning is really only one part of a much larger problem that we have not talked about yet, which is scope.";
    const chunks = splitForSpeech(rambling);

    expect(at(chunks, 0).length).toBeLessThanOrEqual(80);
    // Cut between words, never inside one.
    expect(rambling.startsWith(at(chunks, 0))).toBe(true);
    expect(rambling[at(chunks, 0).length]).toBe(" ");
  });

  it("does not mangle a single unbreakable token", async () => {
    // A URL or long compound has no boundary to cut at; better one slow chunk
    // than a word sliced in half.
    const url = `https://example.com/${"a".repeat(120)}`;
    expect(splitForSpeech(url)).toEqual([url]);
  });

  it("preserves the full text across chunks", async () => {
    // Losing a word would be inaudible in review but wrong in the ledger, since
    // agent_turn.text records what was actually spoken.
    const reply = "First point. Second point, with a clause; and a third — plus a final thought.";
    const chunks = splitForSpeech(reply);

    const rejoined = chunks.join(" ").replace(/\s+/g, " ");
    for (const word of ["First", "Second", "clause", "third", "final"]) {
      expect(rejoined).toContain(word);
    }
  });

  it("allows later chunks to be larger than the first", async () => {
    // Later chunks synthesise while earlier audio plays, so their latency is
    // hidden — fewer requests means fewer seams.
    const reply = `Short one. ${"A fairly long continuing clause that keeps going. ".repeat(4)}`;
    const chunks = splitForSpeech(reply);

    expect(at(chunks, 0).length).toBeLessThanOrEqual(80);
    expect(Math.max(...chunks.slice(1).map((c) => c.length))).toBeGreaterThan(at(chunks, 0).length);
  });

  it("never emits a tiny opening fragment followed by a long chunk", async () => {
    // The bug this was written for. A greedy split produced "Right," (6 chars,
    // ~0.4s of audio) then a 191-character chunk (~2.4s to synthesise) — a
    // two-second hole immediately after the agent starts talking, which is worse
    // than simply having started later.
    const reply =
      "Right, so what were you saying about the deadline? I think the point you made about scope is the one that actually matters here, and it might be worth writing that down before it gets away from you.";
    const chunks = splitForSpeech(reply);

    expect(at(chunks, 0).length).toBeGreaterThanOrEqual(20);
    expect(findSpeechGaps(chunks)).toEqual([]);
  });

  it("keeps the audio flowing for a range of replies", async () => {
    // The ramp is what prevents a stall, so assert the property directly rather
    // than pinning chunk sizes that a tuning change would legitimately move.
    const replies = [
      "Yes — and that is the part worth writing down, because it will be gone by the time you park.",
      "Three things there, actually: the deadline, the scope, and whether the field study still fits.",
      "Mm. Say more about the scope one, because that sounded like the thing you keep returning to.",
      "I would push back on that. You said the opposite last Tuesday, and nothing has changed since.",
    ];

    for (const reply of replies) {
      const chunks = splitForSpeech(reply);
      expect(findSpeechGaps(chunks), `stalled on: ${reply}`).toEqual([]);
    }
  });

  it("ships an over-long opening clause rather than cutting mid-phrase", async () => {
    // Splitting inside a clause would be audible. Better one slow first chunk
    // than a reply that sounds chopped.
    const noBoundaries = "a".repeat(120);
    expect(splitForSpeech(noBoundaries)).toEqual([noBoundaries]);
  });

  it("returns nothing for empty or whitespace input", async () => {
    expect(splitForSpeech("")).toEqual([]);
    expect(splitForSpeech("   \n ")).toEqual([]);
  });
});
