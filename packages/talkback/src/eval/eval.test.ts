import { describe, expect, it } from "vitest";
import { OUTPUT_CONTRACT, SYSTEM_PROMPT } from "../prompt";
import { CASES, findCases } from "./cases";
import { checkReply } from "./checks";
import { parseJudgement, renderTurnForJudge } from "./judge";
import { ingestionEvents, newTraceId } from "./langfuse";
import { buildTurnMessages, composeContextBlock } from "./messages";

const silentCase = CASES.find((c) => c.id === "mid-sentence")!;
const speakCase = CASES.find((c) => c.id === "recall-present")!;
const eitherCase = CASES.find((c) => c.id === "landed-quiet")!;

describe("the cases", () => {
  it("have unique ids and a stated purpose", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) expect(c.about.length).toBeGreaterThan(10);
  });

  it("can be selected by id and refuse an unknown one", () => {
    expect(findCases(["stuck", "mid-sentence"]).map((c) => c.id)).toEqual(["mid-sentence", "stuck"]);
    expect(() => findCases(["nope"])).toThrow(/unknown case/);
    expect(findCases(null)).toBe(CASES);
  });
});

describe("the deterministic checks", () => {
  it("accept the sentinel where silence is expected, in every dressing", () => {
    for (const reply of ["<silence>", " <silence>.", '"<silence>"']) {
      expect(checkReply(silentCase, reply, 25).pass).toBe(true);
    }
  });

  it("fail speech where silence was expected, and silence where speech was", () => {
    expect(checkReply(silentCase, "Go on.", 25).failures[0]).toMatch(/spoke when/);
    expect(checkReply(speakCase, "<silence>", 25).failures[0]).toMatch(/stayed silent/);
  });

  it("lets an 'either' case go both ways but still holds it to the contract", () => {
    expect(checkReply(eitherCase, "<silence>", 25).pass).toBe(true);
    expect(checkReply(eitherCase, "That also closes the Tuesday question.", 25).pass).toBe(true);
    expect(checkReply(eitherCase, "Sure! That also closes the Tuesday question.", 25).failures).toContain(
      'preamble: "Sure! That also"',
    );
  });

  it("enforces the word cap, one question, no markdown, no emoji, no sign-off", () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    expect(checkReply(eitherCase, long, 25).failures).toContain("30 words, cap is 25");
    expect(checkReply(eitherCase, "Why? And when?", 25).failures).toContain("2 questions, at most one");
    expect(checkReply(eitherCase, "- first\n- second", 25).failures).toContain("markdown in speech");
    expect(checkReply(eitherCase, "Nice one 🎉", 25).failures).toContain("emoji in speech");
    expect(checkReply(eitherCase, "Done. Let me know if you need more.", 25).failures).toContain("sign-off");
  });

  it("checks mustMention and mustNotMention against the spoken text", () => {
    const good = checkReply(speakCase, "Yesterday you said you'd call Niklas about the evaluation section before Friday.", 25);
    expect(good.pass).toBe(true);
    const bad = checkReply(speakCase, "You mentioned someone yesterday.", 25);
    expect(bad.failures).toEqual(["missing: /Niklas/", "missing: /evaluation|growth|Friday|call/"]);
    const absent = CASES.find((c) => c.id === "recall-absent")!;
    expect(checkReply(absent, "You said six participants.", 25).failures).toEqual(
      expect.arrayContaining([expect.stringMatching(/must not say/)]),
    );
  });

  it("does not hold a draft body to the word cap, and still checks the speech around it", () => {
    const body = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const result = checkReply(eitherCase, `Drafted it.\n<draft title="Email to William">${body}</draft>`, 25);
    expect(result.drafts).toEqual(["Email to William"]);
    expect(result.spoken).toBe("Drafted it.");
    expect(result.pass).toBe(true);
  });

  it("strips a sentinel emitted alongside speech and flags it", () => {
    const result = checkReply(eitherCase, "<silence> That closes it.", 25);
    expect(result.spoken).toBe("That closes it.");
    expect(result.failures).toContain("sentinel emitted alongside speech");
  });

  it("fails a spoken speaker tag and a narrated decision, as heard on the 9 Sep drive", () => {
    const narrated = CASES.find((c) => c.id === "two-people-narrated-rule")!;
    const heard = checkReply(
      narrated,
      "[Speaker 2]'s question — whether it'll talk back — is for them to test live, not for me to answer.",
      25,
    );
    expect(heard.failures).toEqual(
      expect.arrayContaining(["speaker tag spoken", "narrated decision", "must not say: /for them to/"]),
    );
    expect(checkReply(narrated, "<silence>", 25).pass).toBe(true);
    expect(checkReply(narrated, "Yes, I can hear you both.", 25).pass).toBe(true);
    expect(checkReply(eitherCase, "I'll stay silent on that one.", 25).failures).toContain("narrated decision");
  });
});

describe("the turn messages, which mirror bot.py", () => {
  it("compose nothing from an empty context", () => {
    expect(composeContextBlock(undefined)).toBeNull();
    expect(composeContextBlock({})).toBeNull();
    expect(composeContextBlock({ passages: [], summary: "  " })).toBeNull();
  });

  it("put threads first, then passages, the drive last, then the background line", () => {
    const withThreads = composeContextBlock({
      threads: [{ text: "Topic: Field study\n- Open: how many participants" }],
      passages: [{ when: "yesterday", text: "call Niklas" }],
    })!;
    expect(withThreads.indexOf("Where things stand")).toBe(0);
    expect(withThreads.indexOf("Topic: Field study")).toBeLessThan(withThreads.indexOf("From their past"));

    const block = composeContextBlock({
      passages: [{ when: "yesterday", text: "call Niklas" }],
      summary: "- Decision: x",
    })!;
    expect(block.indexOf("From their past recordings:")).toBe(0);
    expect(block).toContain("[yesterday] call Niklas");
    expect(block.indexOf("So far in this drive:")).toBeGreaterThan(block.indexOf("[yesterday]"));
    expect(block.endsWith("That is background. Answer only what was just said to you.")).toBe(true);
  });

  it("append the pending confirmation ask after the background, or alone", () => {
    const withBlock = composeContextBlock({ summary: "- x", pending: "send the diary" })!;
    expect(withBlock).toMatch(/Answer only what was just said to you\.\n\nThey earlier asked for this/);
    const alone = composeContextBlock({ pending: "send the diary" })!;
    expect(alone.startsWith("They earlier asked for this")).toBe(true);
    expect(alone).toContain("cannot be undone: send the diary");
  });

  it("order the turn as system, history, context block, then what was said", () => {
    const { messages, composed } = buildTurnMessages({
      compose: { setting: "walking" },
      history: [{ role: "user", content: "[Speaker 1] earlier" }],
      context: { summary: "- x" },
      said: "now",
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "system", "user"]);
    expect(messages[0]!.content.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(messages[0]!.content.endsWith(OUTPUT_CONTRACT)).toBe(true);
    expect(messages[3]!.content).toBe("now");
    expect(composed.maxReplyWords).toBe(35);
  });

  it("swap in a candidate base prompt and keep the contract last", () => {
    const { messages } = buildTurnMessages({ compose: { base: "CANDIDATE" }, said: "x" });
    expect(messages[0]!.content.startsWith("CANDIDATE")).toBe(true);
    expect(messages[0]!.content.endsWith(OUTPUT_CONTRACT)).toBe(true);
  });
});

describe("the judge's output", () => {
  it("parses a fenced or prefixed JSON object", () => {
    const raw = 'Here you go:\n```json\n{"turn_decision":5,"brevity":4,"grounding":5,"register":4,"verdict":"pass","reason":"fine"}\n```';
    expect(parseJudgement(raw)).toEqual({
      turn_decision: 5,
      brevity: 4,
      grounding: 5,
      register: 4,
      verdict: "pass",
      reason: "fine",
    });
  });

  it("restates the verdict rule when the judge forgets it", () => {
    const raw = '{"turn_decision":2,"brevity":5,"grounding":5,"register":5,"verdict":"pass","reason":"spoke over them"}';
    expect(parseJudgement(raw).verdict).toBe("fail");
  });

  it("rejects an out-of-range score or no JSON at all", () => {
    expect(() => parseJudgement("no json here")).toThrow(/no JSON/);
    expect(() => parseJudgement('{"turn_decision":9,"brevity":5,"grounding":5,"register":5}')).toThrow(/out of range/);
  });

  it("shows the judge the instructions, the exchange, the reply and the purpose", () => {
    const doc = renderTurnForJudge(
      [
        { role: "system", content: "SYS" },
        { role: "user", content: "hello" },
      ],
      "<silence>",
      "why",
    );
    expect(doc).toMatch(/INSTRUCTIONS ===\nSYS/);
    expect(doc).toContain("USER: hello");
    expect(doc).toMatch(/REPLIED ===\n<silence>/);
    expect(doc.endsWith("why")).toBe(true);
  });
});

describe("langfuse", () => {
  it("makes trace ids of 32 lowercase hex characters", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("builds one trace, its generations and its scores as an ingestion batch", () => {
    const startedAt = new Date("2026-09-08T10:00:00Z");
    const events = ingestionEvents(
      {
        id: "t".repeat(32),
        name: "eval · stuck",
        sessionId: "run-1",
        tags: ["talkback-eval"],
        version: "talkback-4",
        input: [{ role: "user", content: "x" }],
        output: "<silence>",
        metadata: { case: "stuck" },
        generations: [
          { name: "talkback.eval.turn", model: "m", input: [], output: "<silence>", startedAt, latencyMs: 1500, usage: { input: 10, output: 2 } },
        ],
        scores: [
          { name: "checks_pass", value: 1 },
          { name: "judge_verdict", value: "pass", comment: "fine" },
        ],
      },
      startedAt,
    );
    expect(events.map((e) => e.type)).toEqual(["trace-create", "generation-create", "score-create", "score-create"]);
    expect(events[0]!.body).toMatchObject({ id: "t".repeat(32), sessionId: "run-1", version: "talkback-4" });
    expect(events[1]!.body).toMatchObject({ traceId: "t".repeat(32), endTime: "2026-09-08T10:00:01.500Z", usage: { input: 10, output: 2 } });
    expect(events[2]!.body).toMatchObject({ name: "checks_pass", value: 1, dataType: "NUMERIC" });
    expect(events[3]!.body).toMatchObject({ name: "judge_verdict", value: "pass", dataType: "CATEGORICAL" });
  });
});
