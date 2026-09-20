import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { OUTPUT_CONTRACT, SYSTEM_PROMPT } from "../prompt";
import { CASES, findCases } from "./cases";
import { checkReply, endsOnAnAgentQuestion } from "./checks";
import { parseJudgement, renderTurnForJudge } from "./judge";
import { langfuseConfig, startLangfuse, traceTurn } from "./langfuse";
import { buildTurnMessages, composeContextBlock } from "./messages";

const silentCase = CASES.find((c) => c.id === "mid-sentence")!;
const speakCase = CASES.find((c) => c.id === "recall-present")!;
const eitherCase = CASES.find((c) => c.id === "landed-quiet")!;

describe("the cases", () => {
  it("have unique ids and a stated purpose", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) expect(c.about.length).toBeGreaterThan(10);
  });

  it("only claim to be answering the agent's own question where one was asked", () => {
    // `expect.answering` turns a silence into a failure, so a case that sets it
    // without an agent question behind it would pin nothing and look as if it
    // did. The reverse is deliberately NOT asserted: `pending-asked-once` also
    // ends on an agent question, and there the right reply is silence.
    const answering = CASES.filter((c) => c.expect.answering);
    expect(answering.length).toBeGreaterThan(0);
    for (const c of answering) expect(endsOnAnAgentQuestion(c), c.id).toBe(true);
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

  it("fails any silence on a turn that answers the agent's own question", () => {
    // The pilot's turn, as a check: the agent had just asked whether to look
    // the times up, and the reply to "Ja." was `<silence>`.
    const answering = CASES.find((c) => c.id === "answer-bare-yes")!;
    expect(checkReply(answering, "<silence>", 25).failures).toContain(
      "declined an answer to its own question",
    );
    expect(checkReply(answering, "Der in Altenholz hat bis achtzehn Uhr offen.", 25).pass).toBe(true);
  });

  it("lets a tool call stand in for speech on an answering turn", () => {
    // Acting on the answer IS the answer; the words come from the completion
    // that reads the tool's result.
    const answering = CASES.find((c) => c.id === "answer-bare-yes")!;
    const withTool = { ...answering, expect: { ...answering.expect, toolCall: { name: "search_web" } } };
    expect(checkReply(withTool, "", 25, [{ name: "search_web", arguments: {} }]).pass).toBe(true);
  });

  it("still allows silence after an agent question the driver did not answer", () => {
    // `pending-asked-once`: the ask was let pass, and what came next was the
    // middle of a different sentence. Silence there is the design working.
    const notAnswering = CASES.find((c) => c.id === "pending-asked-once")!;
    expect(notAnswering.expect.answering).toBeUndefined();
    expect(checkReply(notAnswering, "<silence>", 25).pass).toBe(true);
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

  it("holds a revision to revising, and a new draft to being new", () => {
    const revise = CASES.find((c) => c.id === "draft-revise-when-asked")!;
    expect(
      checkReply(revise, 'Shorter.<draft revises="3f9a2c" title="Email">Pilot Monday.</draft>', 25)
        .pass,
    ).toBe(true);
    // The old behaviour: a second card with nothing linking it to the first.
    expect(
      checkReply(revise, 'Shorter.<draft title="Email">Pilot Monday.</draft>', 25).failures,
    ).toEqual(expect.arrayContaining([expect.stringMatching(/expected revises/)]));
    // Right intent, wrong draft.
    expect(
      checkReply(revise, 'Shorter.<draft revises="b7e40d" title="Email">x</draft>', 25).failures,
    ).toEqual(expect.arrayContaining([expect.stringMatching(/expected revises/)]));

    const fresh = CASES.find((c) => c.id === "draft-new-when-different")!;
    expect(
      checkReply(fresh, 'Done.<draft title="Niklas">Does Thursday work?</draft>', 25).pass,
    ).toBe(true);
    expect(
      checkReply(fresh, 'Done.<draft revises="3f9a2c" title="Niklas">x</draft>', 25).failures,
    ).toEqual(expect.arrayContaining([expect.stringMatching(/where a NEW draft was wanted/)]));

    const none = CASES.find((c) => c.id === "draft-seen-not-rewritten")!;
    expect(checkReply(none, "An email to William and a reading list.", 25).pass).toBe(true);
    expect(
      checkReply(none, 'Here.<draft title="Email">again</draft>', 25).failures,
    ).toEqual(expect.arrayContaining([expect.stringMatching(/where none was wanted/)]));
  });

  it("says a handle read aloud is a failure, however right the draft was", () => {
    const revise = CASES.find((c) => c.id === "draft-revise-when-asked")!;
    const spoken = checkReply(
      revise,
      'Shortened 3f9a2c.<draft revises="3f9a2c" title="Email">Pilot Monday.</draft>',
      25,
    );
    expect(spoken.failures).toContain("must not say: /3f9a2c/");
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

describe("the tool-call checks", () => {
  const dropCase = CASES.find((c) => c.id === "board-remove-drops")!;
  const hands = CASES.find((c) => c.id === "board-mention-no-edit")!;

  it("passes the expected call with matching arguments, and needs no words on that step", () => {
    const result = checkReply(dropCase, "", 60, [{ name: "move_task", arguments: { card: "1225b3", column: "dropped" } }]);
    expect(result.pass).toBe(true);
  });

  it("fails the wrong tool, a wrong argument, or no call at all", () => {
    expect(checkReply(dropCase, "", 60, [{ name: "remove_task", arguments: { card: "1225b3" } }]).failures[0]).toMatch(
      /called remove_task, expected move_task/,
    );
    expect(
      checkReply(dropCase, "", 60, [{ name: "move_task", arguments: { card: "1225b3", column: "done" } }]).failures[0],
    ).toMatch(/column/);
    expect(checkReply(dropCase, "Dropped it.", 60).failures).toContain("did not call move_task");
  });

  it("fails a tool call where none was wanted", () => {
    const result = checkReply(hands, "", 60, [{ name: "move_task", arguments: { card: "1225b3", column: "done" } }]);
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toMatch(/unexpected tool call/);
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

  it("put the board ahead of everything, as Recall._compose does", () => {
    const block = composeContextBlock({
      board: "Their task board right now:\n- [doing] ethics form",
      threads: [{ text: "Topic: Field study" }],
    })!;
    expect(block.indexOf("Their task board right now:")).toBe(0);
    expect(block.indexOf("[doing] ethics form")).toBeLessThan(block.indexOf("Where things stand"));
  });

  it("put the drafts after the quotes and before the drive, as `_compose` does", () => {
    const block = composeContextBlock({
      threads: [{ text: "Topic: Field study" }],
      passages: [{ when: "yesterday", text: "call Niklas" }],
      drafts: 'Drafts you have written on this drive, and which you can still see:\ndraft 3f9a2c "Email" (v1.0, written by you)',
      summary: "- Decision: x",
    })!;

    expect(block.indexOf("Drafts you have written")).toBeGreaterThan(
      block.indexOf("From their past recordings:"),
    );
    // The summary stays LAST, closest to the user's message: that is what
    // "that" and "the second one" resolve against.
    expect(block.indexOf("So far in this drive:")).toBeGreaterThan(
      block.indexOf("Drafts you have written"),
    );
  });

  it("append the pending confirmation ask after the background, or alone", () => {
    const withBlock = composeContextBlock({ summary: "- x", pending: "send the diary" })!;
    expect(withBlock).toMatch(/Answer only what was just said to you\.\n\nThey earlier asked for this/);
    const alone = composeContextBlock({ pending: "send the diary" })!;
    expect(alone.startsWith("They earlier asked for this")).toBe(true);
    expect(alone).toContain("cannot be undone: send the diary");
  });

  it("word a repeat ask so it can be let go of", () => {
    const first = composeContextBlock({ pending: "send the diary", pendingAskedCount: 0 })!;
    const repeat = composeContextBlock({ pending: "send the diary", pendingAskedCount: 1 })!;
    expect(first).toContain("ask in one short sentence");
    expect(repeat).toContain("already asked about it once");
    expect(repeat).not.toContain("ask in one short sentence");
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

  /**
   * An unprompted turn has the engine's instruction where the driver's words
   * would be — the shape `Offers` produces in the container. Nobody spoke, so
   * the check the reply runs against is the same one every turn runs against.
   */
  it("place the engine's nudge in the driver's slot on an unprompted turn", () => {
    const { messages } = buildTurnMessages({
      compose: { setting: "driving" },
      history: [{ role: "user", content: "earlier" }, { role: "assistant", content: "mm" }],
      context: { summary: "- x" },
      nudge: "(An unprompted moment.)",
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "system", "user"]);
    expect(messages.at(-1)!.content).toBe("(An unprompted moment.)");
  });

  it("refuse a turn that has both or neither a speaker and a nudge", () => {
    expect(() => buildTurnMessages({ compose: {}, said: "hi", nudge: "(x)" })).toThrow(/exactly one/);
    expect(() => buildTurnMessages({ compose: {} })).toThrow(/exactly one/);
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
  it("prefers LANGFUSE_BASE_URL and falls back to the v3 LANGFUSE_HOST", () => {
    const keys = { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" };
    expect(langfuseConfig({ ...keys } as NodeJS.ProcessEnv)?.baseUrl).toBe(
      "https://cloud.langfuse.com",
    );
    expect(
      langfuseConfig({ ...keys, LANGFUSE_HOST: "https://lf.example/" } as NodeJS.ProcessEnv)
        ?.baseUrl,
    ).toBe("https://lf.example");
    expect(
      langfuseConfig({
        ...keys,
        LANGFUSE_HOST: "https://old.example",
        LANGFUSE_BASE_URL: "https://new.example",
      } as NodeJS.ProcessEnv)?.baseUrl,
    ).toBe("https://new.example");
    expect(langfuseConfig({ LANGFUSE_PUBLIC_KEY: "pk" } as NodeJS.ProcessEnv)).toBeNull();
  });

  it("exports the turn as a root observation with generations under it", async () => {
    const exporter = new InMemorySpanExporter();
    const langfuse = startLangfuse(
      {
        baseUrl: "https://lf.example",
        publicKey: "pk",
        secretKey: "sk",
        environment: "eval-test",
      },
      { exporter },
    );

    // Record the scores instead of queueing them for delivery: this test is
    // about what gets built, and a real queue would reach for the network.
    const scored: { name: string; value: unknown; dataType: string; span: string }[] = [];
    langfuse.client.score.observation = (observation, data) => {
      scored.push({
        name: data.name,
        value: data.value,
        dataType: String(data.dataType),
        span: observation.otelSpan.spanContext().spanId,
      });
    };

    const startedAt = new Date("2026-09-08T10:00:00Z");
    const traceId = traceTurn(langfuse, {
      name: "eval · stuck",
      sessionId: "run-1",
      tags: ["talkback-eval"],
      version: "talkback-4",
      input: [{ role: "user", content: "x" }],
      output: "<silence>",
      metadata: { case: "stuck" },
      generations: [
        {
          name: "talkback.eval.turn",
          model: "m",
          input: [],
          output: "<silence>",
          startedAt,
          latencyMs: 1500,
          usage: { input: 10, output: 2 },
        },
      ],
      scores: [
        { name: "checks_pass", value: 1 },
        { name: "judge_verdict", value: "pass", comment: "fine" },
      ],
      startedAt,
    });
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    await langfuse.processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === "eval · stuck")!;
    const generation = spans.find((s) => s.name === "talkback.eval.turn")!;
    expect(root).toBeDefined();
    expect(generation).toBeDefined();

    // One trace, the generation beneath the root.
    expect(generation.spanContext().traceId).toBe(traceId);
    expect(generation.parentSpanContext?.spanId).toBe(root.spanContext().spanId);

    // Overall input/output on the ROOT OBSERVATION, never as trace input/output.
    expect(root.attributes["langfuse.observation.input"]).toContain('"role":"user"');
    expect(root.attributes["langfuse.observation.output"]).toBe("<silence>");
    expect(root.attributes["langfuse.trace.input"]).toBeUndefined();
    expect(root.attributes["langfuse.trace.output"]).toBeUndefined();
    expect(root.attributes["langfuse.trace.name"]).toBe("eval · stuck");

    // The correlating attributes reach the cost-bearing generation too, which
    // is what makes session cost and a filter on `version` add up.
    for (const span of [root, generation]) {
      expect(span.attributes["session.id"]).toBe("run-1");
      expect(span.attributes["langfuse.version"]).toBe("talkback-4");
      expect(span.attributes["langfuse.environment"]).toBe("eval-test");
      expect(span.attributes["langfuse.trace.tags"]).toEqual(["talkback-eval"]);
    }

    expect(generation.attributes["langfuse.observation.type"]).toBe("generation");
    expect(generation.attributes["langfuse.observation.model.name"]).toBe("m");
    expect(generation.attributes["langfuse.observation.usage_details"]).toBe(
      '{"input":10,"output":2}',
    );

    // Reconstructed with the timings the turn actually had, not export time.
    expect(hrTimeMs(generation.startTime)).toBe(startedAt.getTime());
    expect(hrTimeMs(generation.endTime)).toBe(startedAt.getTime() + 1500);

    // Scored against the ROOT OBSERVATION, so each score carries an
    // observation id as well as a trace id.
    expect(scored).toEqual([
      { name: "checks_pass", value: 1, dataType: "NUMERIC", span: root.spanContext().spanId },
      { name: "judge_verdict", value: "pass", dataType: "CATEGORICAL", span: root.spanContext().spanId },
    ]);

    await langfuse.provider.shutdown();
  });
});

/** OpenTelemetry timestamps are [seconds, nanoseconds]. */
function hrTimeMs([seconds, nanos]: [number, number]): number {
  return seconds * 1000 + Math.round(nanos / 1e6);
}
