import { describe, expect, it } from "vitest";
import type { Block, Topic } from "@voicemural/workspace";
import { contentHash, cutPassages, mergePassages, renderTopicForMemory } from "./memory";

const S = "11111111-1111-1111-1111-111111111111";

function u(id: string, start: number, text: string, durMs = 3000) {
  return { id, startOffsetMs: start, endOffsetMs: start + durMs, text };
}

describe("cutPassages", () => {
  it("joins consecutive utterances into one passage keyed by its first offset", () => {
    const passages = cutPassages(S, [u("a", 0, "So the deadline"), u("b", 3000, "is mid September.")], []);
    expect(passages).toEqual([
      {
        refId: `${S}:0`,
        startOffsetMs: 0,
        endOffsetMs: 6000,
        text: "So the deadline is mid September.",
        utteranceIds: ["a", "b"],
      },
    ]);
  });

  it("closes a passage on the time window, the character cap, or a long gap", () => {
    const byTime = cutPassages(S, [u("a", 0, "one"), u("b", 41_000, "two")], []);
    expect(byTime.map((p) => p.text)).toEqual(["one", "two"]);

    // Distinct texts: two identical lines would be collapsed by the echo
    // filter's own repeat rule before the cut ever saw them.
    const byChars = cutPassages(S, [u("a", 0, "x".repeat(400)), u("b", 3000, "y".repeat(400))], []);
    expect(byChars).toHaveLength(2);

    const byGap = cutPassages(S, [u("a", 0, "one"), u("b", 20_000, "two")], []);
    expect(byGap).toHaveLength(2);
    const noGap = cutPassages(S, [u("a", 0, "one"), u("b", 10_000, "two")], []);
    expect(noGap).toHaveLength(1);
  });

  it("removes the agent's own echoed voice and Whisper's sign-offs before storing", () => {
    const passages = cutPassages(
      S,
      [
        u("a", 0, "What did I decide about the study size?"),
        u("b", 3000, "You said three to six participants, two weeks each."),
        u("c", 6000, "Right, six then. Thanks for watching!"),
      ],
      ["You said three to six participants, two weeks each."],
    );
    expect(passages).toHaveLength(1);
    expect(passages[0]!.text).toBe("What did I decide about the study size? Right, six then.");
    expect(passages[0]!.utteranceIds).toEqual(["a", "c"]);
  });

  it("returns nothing for a drive that was all echo or silence", () => {
    expect(cutPassages(S, [u("a", 0, "Yes, I can hear you.")], ["Yes, I can hear you."])).toEqual([]);
    expect(cutPassages(S, [], [])).toEqual([]);
  });
});

describe("renderTopicForMemory", () => {
  const topic: Topic = {
    id: "t1",
    title: "Field study",
    slug: "field-study",
    icon: "Users",
    createdAt: new Date(0),
    lastTouchedAt: new Date(0),
  };
  const block = (kind: Block["kind"], text: string, extra: Partial<Block> = {}): Block => ({
    id: `${kind}-${text.length}`,
    topicId: "t1",
    kind,
    text,
    spans: [],
    occurredAt: new Date(0),
    ...extra,
  });

  it("puts claims first, then details, open questions and next steps, as labelled lines", () => {
    const text = renderTopicForMemory(topic, [
      block("question", "Is three participants enough?"),
      block("task", "Draft the ethics form", { state: "in_progress" as Block["state"] }),
      block("claim", "Two weeks per participant."),
      block("fact", "6", { label: "Participants" }),
      block("context", "background noise"),
    ]);
    expect(text).toBe(
      [
        "Topic: Field study",
        "- Two weeks per participant.",
        "- Details: Participants: 6",
        "- Open: Is three participants enough?",
        "- Next: Draft the ethics form (in_progress)",
      ].join("\n"),
    );
  });

  it("trims from the end under the cap and never drops the title", () => {
    const blocks = Array.from({ length: 40 }, (_, i) => block("claim", `Claim number ${i} with some length to it.`));
    const text = renderTopicForMemory(topic, blocks, 200);
    expect(text.startsWith("Topic: Field study\n- Claim number 0")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(200);
  });

  it("hashes deterministically", () => {
    expect(contentHash("a")).toBe(contentHash("a"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
    expect(contentHash("a")).toHaveLength(32);
  });
});

describe("mergePassages", () => {
  const at = (ms: number) => new Date(ms);
  it("keeps lexical hits first and fills with semantic ones that do not overlap", () => {
    const merged = mergePassages(
      [{ occurredAt: at(0), text: "the deadline is september", captureSessionId: "s1" }],
      [
        { occurredAt: at(30_000), text: "same drive, a moment later", captureSessionId: "s1" },
        { occurredAt: at(90_000), text: "same drive, well after", captureSessionId: "s1" },
        { occurredAt: at(0), text: "the deadline is september", captureSessionId: "s2" },
        { occurredAt: at(0), text: "another drive entirely", captureSessionId: "s3" },
      ],
      3,
    );
    expect(merged.map((p) => p.text)).toEqual([
      "the deadline is september",
      "same drive, well after",
      "another drive entirely",
    ]);
    expect(Object.keys(merged[0]!)).toEqual(["occurredAt", "text"]);
  });
});
