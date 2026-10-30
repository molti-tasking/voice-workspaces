import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { startLangfuse, traceTurn } from "./eval/langfuse";
import { REALTIME_TRACE_NAME, liveLangfuse, realtimeTurnRecord, resetLiveLangfuse, traceRealtimeTurn } from "./langfuse-live";

const turn = {
  captureSessionId: "drive-1",
  seq: 7,
  text: "Abisko is a good base for the hikes.",
  respondingToText: "Where should we stay?",
  kind: "reply",
  configVersion: "talkback-25",
  requestedModel: "gpt-realtime",
  promptTokens: 120,
  completionTokens: 14,
  totalLatencyMs: 900,
  startOffsetMs: 60_000,
  endOffsetMs: 63_000,
  bargedIn: false,
  toolCalls: [{ name: "add_task", latencyMs: 50 }],
};

afterEach(() => resetLiveLangfuse());

describe("realtimeTurnRecord", () => {
  it("files a live turn as one trace, its words on the root and the model call under it", () => {
    const now = new Date("2026-10-30T17:00:00Z");
    const record = realtimeTurnRecord(turn, now);
    expect(record).toMatchObject({
      name: REALTIME_TRACE_NAME,
      sessionId: "drive-1",
      tags: ["realtime", "reply"],
      version: "talkback-25",
      input: "Where should we stay?",
      output: "Abisko is a good base for the hikes.",
      metadata: { seq: 7, kind: "reply", start_offset_ms: 60_000, end_offset_ms: 63_000, barged_in: false, tool_calls: ["add_task"] },
      scores: [],
    });
    expect(record.generations).toEqual([
      {
        name: "realtime-reply",
        model: "gpt-realtime",
        input: "Where should we stay?",
        output: "Abisko is a good base for the hikes.",
        startedAt: new Date(now.getTime() - 900),
        latencyMs: 900,
        usage: { input: 120, output: 14 },
      },
    ]);
  });

  it("still makes a trace of a turn that says little about itself", () => {
    const record = realtimeTurnRecord({ captureSessionId: "d", seq: 0, text: "Hi.", startOffsetMs: 0, endOffsetMs: 500 });
    expect(record.version).toBe("unknown");
    expect(record.tags).toEqual(["realtime", "reply"]);
    expect(record.generations[0]).not.toHaveProperty("usage");
    expect(record.generations[0]!.model).toBe("realtime");
  });
});

describe("live tracing", () => {
  it("is off, and harmless, without keys", () => {
    expect(liveLangfuse({} as NodeJS.ProcessEnv)).toBeNull();
    expect(traceRealtimeTurn(turn)).toBeNull();
  });

  it("puts the session and version on the generation as well as the root (v4)", async () => {
    const exporter = new InMemorySpanExporter();
    const langfuse = startLangfuse(
      { baseUrl: "https://lf.example", publicKey: "pk", secretKey: "sk", environment: "study" },
      { exporter },
    );
    const traceId = traceTurn(langfuse, realtimeTurnRecord(turn));
    await langfuse.processor.forceFlush();
    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === REALTIME_TRACE_NAME)!;
    const generation = spans.find((s) => s.name === "realtime-reply")!;

    expect(generation.spanContext().traceId).toBe(traceId);
    expect(generation.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(root.attributes["langfuse.observation.output"]).toBe(turn.text);
    expect(root.attributes["langfuse.trace.output"]).toBeUndefined();
    for (const span of [root, generation]) {
      expect(span.attributes["session.id"]).toBe("drive-1");
      expect(span.attributes["langfuse.version"]).toBe("talkback-25");
      expect(span.attributes["langfuse.environment"]).toBe("study");
    }
    expect(generation.attributes["langfuse.observation.type"]).toBe("generation");
    await langfuse.provider.shutdown();
  });
});
