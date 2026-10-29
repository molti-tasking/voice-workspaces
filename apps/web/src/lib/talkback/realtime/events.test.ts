import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "../conversation";
import { HOLD_MS, RealtimeConversation, heardOf, type FinishedTurn } from "./events";

/**
 * Event sequences as gpt-realtime-2.1 sent them through the proxy on
 * 26 Oct 2026 (scratch smoke test): their transcript landing after the
 * answer has begun, a lead-in and an answer in one response, and a barge-in.
 */

function harness() {
  vi.setSystemTime(1_000_000);
  const messages: ConversationMessage[] = [];
  const began: string[] = [];
  const heard: [string, string][] = [];
  const finished: FinishedTurn[] = [];
  const speaking: string[] = [];
  const conversation = new RealtimeConversation({
    // The faked clock, so time moved on by the timers is time for the pacing too.
    now: () => Date.now(),
    emit: (m) => messages.push(m),
    began: (id) => began.push(id),
    heard: (who, text) => heard.push([who, text]),
    userSpeaking: (on) => speaking.push(`user:${on}`),
    agentSpeaking: (on) => speaking.push(`agent:${on}`),
    finished: (t) => finished.push(t),
  });
  const at = (ms: number) => vi.setSystemTime(1_000_000 + ms);
  const send = (ms: number, type: string, rest: Record<string, unknown> = {}) => {
    at(ms);
    conversation.handle({ type, ...rest });
  };
  return { conversation, messages, began, heard, finished, speaking, send, at };
}

const said = "I want to plan a weekend away with two friends. Where should we go?";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RealtimeConversation", () => {
  it("files their turn before the answer that began before its transcript", () => {
    const h = harness();
    h.send(0, "input_audio_buffer.speech_started", { item_id: "item_u1" });
    h.send(7000, "input_audio_buffer.speech_stopped", { item_id: "item_u1" });
    h.send(7005, "input_audio_buffer.committed", { item_id: "item_u1" });
    h.send(7010, "response.created", { response: { id: "resp_1" } });
    h.send(7400, "response.output_audio_transcript.delta", { response_id: "resp_1", item_id: "item_a1", output_index: 0, delta: "Nice plan!" });
    h.send(7800, "output_audio_buffer.started", { response_id: "resp_1" });
    // Held: nothing of the answer is on screen before their words are.
    expect(h.began).toEqual([]);
    h.send(8100, "conversation.item.input_audio_transcription.completed", { item_id: "item_u1", transcript: said });
    expect(h.began).toEqual(["item_u1", "resp_1"]);
    expect(h.messages.map((m) => m.type)).toEqual(["user", "agent"]);
  });

  it("makes the lead-in and the answer one agent turn, and records it once its audio stops", () => {
    const h = harness();
    h.send(0, "input_audio_buffer.speech_stopped", { item_id: "item_u1" });
    h.send(5, "input_audio_buffer.committed", { item_id: "item_u1" });
    h.send(400, "conversation.item.input_audio_transcription.completed", { item_id: "item_u1", transcript: said });
    h.send(410, "response.created", { response: { id: "resp_1" } });
    h.send(700, "response.output_audio_transcript.delta", { response_id: "resp_1", output_index: 0, delta: "Nice plan!" });
    h.send(900, "output_audio_buffer.started", { response_id: "resp_1" });
    h.send(1500, "response.output_audio_transcript.done", { response_id: "resp_1", output_index: 0, transcript: "Nice plan!" });
    h.send(1600, "response.output_audio_transcript.done", { response_id: "resp_1", output_index: 1, transcript: "Try Odense by train." });
    h.send(1700, "response.done", {
      response: { id: "resp_1", status: "completed", usage: { input_tokens: 112, output_tokens: 431 } },
    });
    expect(h.finished).toEqual([]);
    h.send(6000, "output_audio_buffer.stopped", { response_id: "resp_1" });

    const agent = h.messages.filter((m) => m.type === "agent");
    expect(new Set(agent.map((m) => (m as { id: string }).id))).toEqual(new Set(["resp_1"]));
    expect((agent.at(-1) as { text: string }).text).toBe("Nice plan! Try Odense by train.");
    expect(h.finished).toHaveLength(1);
    expect(h.finished[0]).toMatchObject({
      trigger: "user_turn",
      cueAtMs: 1_000_000,
      audioStartMs: 1_000_900,
      audioEndMs: 1_006_000,
      generatedText: "Nice plan! Try Odense by train.",
      text: "Nice plan! Try Odense by train.",
      bargedIn: false,
      respondingToText: said,
      inputTokens: 112,
      outputTokens: 431,
    });
    expect(h.heard).toEqual([
      ["user", said],
      ["agent", "Nice plan! Try Odense by train."],
    ]);
    expect(h.speaking).toEqual(["user:false", "agent:true", "agent:false"]);
  });

  it("records a reply they spoke over as what was heard of it, marked", () => {
    const h = harness();
    h.conversation.expect("poke");
    h.send(0, "response.created", { response: { id: "resp_2" } });
    const long = "Check transport prices to two or three nearby cities, then pick the best deal and lock in a hostel.";
    h.send(200, "response.output_audio_transcript.done", { response_id: "resp_2", output_index: 0, transcript: long });
    h.send(300, "output_audio_buffer.started", { response_id: "resp_2" });
    h.send(400, "response.done", { response: { id: "resp_2", status: "completed" } });
    h.send(2300, "input_audio_buffer.speech_started", { item_id: "item_u2" });
    h.send(2300, "output_audio_buffer.cleared", { response_id: "resp_2" });

    const [turn] = h.finished;
    expect(turn).toMatchObject({ trigger: "poke", bargedIn: true, generatedText: long, respondingToText: null });
    expect(turn!.text).toBe(heardOf(long, 2000));
    expect(turn!.text.length).toBeLessThan(long.length);
    expect(h.messages.at(-1)).toMatchObject({ type: "agent", id: "resp_2", interrupted: true, text: turn!.text });
  });

  it("shows an answer anyway when their transcript never comes", () => {
    const h = harness();
    h.send(0, "input_audio_buffer.committed", { item_id: "item_u1" });
    h.send(10, "response.created", { response: { id: "resp_1" } });
    h.send(300, "response.output_audio_transcript.delta", { response_id: "resp_1", output_index: 0, delta: "Hm?" });
    h.send(400, "output_audio_buffer.started", { response_id: "resp_1" });
    expect(h.messages).toEqual([]);
    vi.advanceTimersByTime(HOLD_MS);
    expect(h.messages).toEqual([{ type: "agent", id: "resp_1", text: "Hm?" }]);
  });

  it("shows a reply as its voice reaches it, not as its transcript arrives", () => {
    const h = harness();
    h.conversation.expect("opening");
    h.send(0, "response.created", { response: { id: "resp_1" } });
    const reply = "Hi! What are you planning today, a trip or something closer to home?";
    // The whole transcript, long before the voice has said it.
    h.send(100, "response.output_audio_transcript.done", { response_id: "resp_1", output_index: 0, transcript: reply });
    expect(h.messages).toEqual([]);

    h.send(500, "output_audio_buffer.started", { response_id: "resp_1" });
    // Seven ticks of the pacer: 1050 ms of voice.
    vi.advanceTimersByTime(1050);
    // The whole reply, so its words can wait in place, and how much the voice has said.
    const early = h.messages.at(-1) as { text: string; voiced?: number };
    expect(early.text).toBe(reply);
    expect(early.voiced).toBe(heardOf(reply, 1050).length);
    expect(early.voiced).toBeLessThan(reply.length);

    h.send(5200, "output_audio_buffer.stopped", { response_id: "resp_1" });
    expect(h.messages.at(-1)).toEqual({ type: "agent", id: "resp_1", text: reply });
    // Said word by word, never back, and never the same message twice.
    const voiced = h.messages.map((m) => (m as { voiced?: number }).voiced ?? reply.length);
    expect(new Set(voiced).size).toBe(voiced.length);
    expect([...voiced].sort((a, b) => a - b)).toEqual(voiced);
    expect(h.began).toEqual(["resp_1"]);
    expect(h.finished).toEqual([]);
    h.send(5300, "response.done", { response: { id: "resp_1", status: "completed" } });
    expect(h.finished[0]).toMatchObject({ trigger: "opening", text: reply, bargedIn: false });
  });

  it("credits a reply to the words of the turn it answers, not the turn before", () => {
    const h = harness();
    h.send(0, "input_audio_buffer.committed", { item_id: "item_u1" });
    h.send(100, "conversation.item.input_audio_transcription.completed", { item_id: "item_u1", transcript: "First." });
    h.send(5000, "input_audio_buffer.committed", { item_id: "item_u2" });
    h.send(5050, "conversation.item.input_audio_transcription.delta", { item_id: "item_u2", delta: "Second" });
    h.send(5100, "response.created", { response: { id: "resp_1" } });
    h.send(5400, "conversation.item.input_audio_transcription.completed", { item_id: "item_u2", transcript: "Second one." });
    h.send(5500, "response.done", { response: { id: "resp_1", status: "completed", output: [{ content: [{ transcript: "Okay." }] }] } });
    expect(h.finished[0]).toMatchObject({ respondingToText: "Second one.", text: "Okay." });
    expect(h.finished[0]!.asrMs).toBe(400);
  });

  it("closes what is open when the connection goes", () => {
    const h = harness();
    h.send(0, "response.created", { response: { id: "resp_1" } });
    h.send(100, "response.output_audio_transcript.delta", { response_id: "resp_1", output_index: 0, delta: "So the" });
    h.send(200, "output_audio_buffer.started", { response_id: "resp_1" });
    h.at(900);
    h.conversation.close();
    expect(h.finished).toHaveLength(1);
    expect(h.finished[0]).toMatchObject({ audioEndMs: 1_000_900, text: "So the" });
    expect(h.speaking.at(-1)).toBe("agent:false");
  });
});

describe("their words while they say them", () => {
  const caption = (h: ReturnType<typeof harness>, ms: number, type: string, rest: Record<string, unknown>) => {
    h.at(ms);
    h.conversation.caption({ type: `conversation.item.input_audio_transcription.${type}`, ...rest });
  };

  it("shows their words live, then replaces them in place with the turn's own transcript", () => {
    const h = harness();
    h.send(0, "input_audio_buffer.speech_started", { item_id: "item_u1" });
    caption(h, 600, "delta", { item_id: "seg_1", delta: "Can you look" });
    caption(h, 900, "delta", { item_id: "seg_1", delta: " up a hotel" });
    expect(h.messages.at(-1)).toEqual({ type: "user", id: "live-1", text: "Can you look up a hotel", live: true });
    expect(h.began).toEqual(["live-1"]);

    // A pause their voice detection cut in two: one turn still.
    caption(h, 2200, "delta", { item_id: "seg_2", delta: "for four?" });
    expect(h.messages.at(-1)).toMatchObject({ id: "live-1", text: "Can you look up a hotel for four?" });

    h.send(3000, "input_audio_buffer.speech_stopped", { item_id: "item_u1" });
    h.send(3005, "input_audio_buffer.committed", { item_id: "item_u1" });
    // The answer is not held: their words are on screen.
    h.send(3010, "response.created", { response: { id: "resp_1" } });
    h.send(3100, "response.output_audio_transcript.delta", { response_id: "resp_1", output_index: 0, delta: "Sure." });
    h.send(3300, "output_audio_buffer.started", { response_id: "resp_1" });
    vi.advanceTimersByTime(600);
    expect(h.messages.some((m) => m.type === "agent")).toBe(true);

    // A partial transcript of the turn would shrink the live words: it waits.
    h.send(3400, "conversation.item.input_audio_transcription.delta", { item_id: "item_u1", delta: "Can you" });
    expect(h.messages.filter((m) => m.type === "user").at(-1)).toMatchObject({ text: "Can you look up a hotel for four?", live: true });
    h.send(3700, "conversation.item.input_audio_transcription.completed", { item_id: "item_u1", transcript: "Can you look up a hotel for four?" });
    expect(h.messages.filter((m) => m.type === "user").at(-1)).toEqual({ type: "user", id: "live-1", text: "Can you look up a hotel for four?" });
    expect(h.began).toEqual(["live-1", "resp_1"]);
    expect(h.heard).toContainEqual(["user", "Can you look up a hotel for four?"]);

    // Late words of the finished turn change nothing now.
    caption(h, 3800, "completed", { item_id: "seg_2", transcript: "for four people?" });
    expect(h.messages.filter((m) => m.type === "user").at(-1)).not.toHaveProperty("live");
  });

  it("keeps a tail that arrives just after the turn was committed, and starts the next turn anew", () => {
    const h = harness();
    caption(h, 500, "delta", { item_id: "seg_1", delta: "Two nights" });
    h.send(1500, "input_audio_buffer.committed", { item_id: "item_u1" });
    caption(h, 1800, "delta", { item_id: "seg_2", delta: "in Skagen" });
    expect(h.messages.at(-1)).toMatchObject({ id: "live-1", text: "Two nights in Skagen", live: true });

    h.send(9000, "input_audio_buffer.speech_started", { item_id: "item_u2" });
    caption(h, 9400, "delta", { item_id: "seg_3", delta: "And breakfast?" });
    expect(h.messages.at(-1)).toMatchObject({ id: "live-2", text: "And breakfast?", live: true });
  });
});

describe("heardOf", () => {
  it("cuts at a whole word, and keeps everything once the time covers it", () => {
    expect(heardOf("one two three four", 300)).toBe("one");
    expect(heardOf("one two", 10_000)).toBe("one two");
    expect(heardOf("one two", 0)).toBe("");
  });
});
