import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildExtractionPrompt,
  computeInputHash,
  deterministicId,
  extractJsonObject,
  parseExtractionResponse,
  stateDigest,
} from "./extract";
import { foldWorkspace } from "./fold";
import type { StoredOp, TranscriptSegment } from "./types";

const SEED = "seed-abc";
const T0 = new Date("2026-08-01T08:00:00Z");

const segments: TranscriptSegment[] = [
  { id: "u1", occurredAt: T0, text: "I'm thinking about my research stay." },
  { id: "u2", occurredAt: T0, text: "I don't know where I want to go yet." },
];

const ops: StoredOp[] = [
  {
    id: "op-1",
    seq: 1,
    occurredAt: T0,
    op: { type: "create_topic", topicId: "topic-a", title: "Research stay" },
  },
  {
    id: "op-2",
    seq: 2,
    occurredAt: T0,
    op: {
      type: "add_block",
      blockId: "block-1",
      topicId: "topic-a",
      kind: "claim",
      text: "I want strong HCI.",
      spans: [],
    },
  },
];

describe("buildExtractionPrompt", () => {
  it("includes existing topic and block ids so the model can reference them", () => {
    const prompt = buildExtractionPrompt(foldWorkspace(ops), segments);
    const user = prompt[1]!.content;

    expect(user).toContain("topic-a");
    expect(user).toContain("block-1");
    expect(user).toContain("Research stay");
  });

  it("labels each new segment with its utterance id, for provenance", () => {
    const user = buildExtractionPrompt(foldWorkspace([]), segments)[1]!.content;

    expect(user).toContain("[u1]");
    expect(user).toContain("[u2]");
  });

  it("says so explicitly when the workspace is empty", () => {
    const user = buildExtractionPrompt(foldWorkspace([]), segments)[1]!.content;
    expect(user).toContain("empty");
  });
});

describe("caching keys", () => {
  it("gives the same hash for the same input", () => {
    const a = computeInputHash({
      promptVersion: PROMPT_VERSION,
      model: "m",
      temperature: 0,
      segments,
      stateDigest: "d",
    });
    const b = computeInputHash({
      promptVersion: PROMPT_VERSION,
      model: "m",
      temperature: 0,
      segments,
      stateDigest: "d",
    });
    expect(a).toBe(b);
  });

  it.each([
    ["prompt version", { promptVersion: "999" }],
    ["model", { model: "other" }],
    ["temperature", { temperature: 0.7 }],
    ["state digest", { stateDigest: "different" }],
  ])("changes when the %s changes", (_label, override) => {
    const base = {
      promptVersion: PROMPT_VERSION,
      model: "m",
      temperature: 0,
      segments,
      stateDigest: "d",
    };
    expect(computeInputHash({ ...base, ...override })).not.toBe(computeInputHash(base));
  });

  it("changes when the transcript text changes", () => {
    const base = {
      promptVersion: PROMPT_VERSION,
      model: "m",
      temperature: 0,
      segments,
      stateDigest: "d",
    };
    const edited = [{ ...segments[0]!, text: "something else" }, segments[1]!];
    expect(computeInputHash({ ...base, segments: edited })).not.toBe(
      computeInputHash(base),
    );
  });

  it("digests state identically for identical state", () => {
    expect(stateDigest(foldWorkspace(ops))).toBe(stateDigest(foldWorkspace(ops)));
    expect(stateDigest(foldWorkspace(ops))).not.toBe(stateDigest(foldWorkspace([])));
  });
});

describe("deterministicId", () => {
  it("is a pure function of its inputs", () => {
    // Reparse re-derives ops from stored responses; random ids would orphan
    // every block on each run and make the determinism guarantee worthless.
    expect(deterministicId("a", "b")).toBe(deterministicId("a", "b"));
    expect(deterministicId("a", "b")).not.toBe(deterministicId("a", "c"));
  });

  it("looks like a UUID so it drops into a uuid column", () => {
    expect(deterministicId("x")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("extractJsonObject", () => {
  it("reads a bare object", () => {
    expect(extractJsonObject('{"ops":[]}')).toBe('{"ops":[]}');
  });

  it("reads through code fences and surrounding prose", () => {
    const raw = 'Sure!\n```json\n{"ops":[]}\n```\nHope that helps.';
    expect(extractJsonObject(raw)).toBe('{"ops":[]}');
  });

  it("does not stop at a brace inside a string", () => {
    const raw = '{"ops":[{"text":"a } brace"}]}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("handles escaped quotes", () => {
    const raw = '{"ops":[{"text":"she said \\"no\\""}]}';
    expect(extractJsonObject(raw)).toBe(raw);
  });

  it("returns null for a truncated object", () => {
    expect(extractJsonObject('{"ops":[{"type":')).toBeNull();
  });

  it("returns null when there is no JSON at all", () => {
    expect(extractJsonObject("I could not do that.")).toBeNull();
  });
});

describe("parseExtractionResponse", () => {
  const parse = (raw: string) => parseExtractionResponse(raw, { idSeed: SEED });

  it("accepts an allowlisted icon and falls back on anything else", () => {
    // An off-list icon is a cosmetic slip; dropping the topic over it would be
    // absurd, so it is coerced rather than rejected.
    const withIcon = parse(
      JSON.stringify({
        ops: [{ type: "create_topic", id: "new:t", title: "Travel", icon: "Plane" }],
      }),
    ).ops[0]!;
    const withJunk = parse(
      JSON.stringify({
        ops: [{ type: "create_topic", id: "new:t", title: "Travel", icon: "NotAnIcon" }],
      }),
    ).ops[0]!;
    const without = parse(
      JSON.stringify({ ops: [{ type: "create_topic", id: "new:t", title: "Travel" }] }),
    ).ops[0]!;

    if (withIcon.type === "create_topic") expect(withIcon.icon).toBe("Plane");
    if (withJunk.type === "create_topic") expect(withJunk.icon).toBe("Notebook");
    if (without.type === "create_topic") expect(without.icon).toBe("Notebook");
  });

  it("leaves the icon untouched on a rename that does not mention one", () => {
    const op = parse(
      JSON.stringify({ ops: [{ type: "rename_topic", topic: "t", title: "New" }] }),
    ).ops[0]!;
    if (op.type === "rename_topic") expect(op.icon).toBeUndefined();
  });

  it("parses topics and blocks, minting ids for new handles", () => {
    const result = parse(
      JSON.stringify({
        ops: [
          { type: "create_topic", id: "new:research-stay", title: "Research stay" },
          {
            type: "add_block",
            topic: "new:research-stay",
            kind: "claim",
            text: "I want strong HCI.",
            sources: ["u1"],
          },
        ],
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.ops).toHaveLength(2);

    const create = result.ops[0]!;
    const add = result.ops[1]!;
    expect(create.type).toBe("create_topic");
    expect(add.type).toBe("add_block");
    // The handle resolved to the same minted id in both ops.
    if (create.type === "create_topic" && add.type === "add_block") {
      expect(add.topicId).toBe(create.topicId);
      expect(create.slug).toBe("research-stay");
      expect(add.spans).toEqual([{ utteranceId: "u1" }]);
    }
  });

  it("passes existing ids through untouched", () => {
    const result = parse(
      JSON.stringify({
        ops: [
          {
            type: "add_block",
            topic: "topic-a",
            kind: "context",
            text: "I live in Aarhus.",
            sources: ["u2"],
          },
        ],
      }),
    );

    const add = result.ops[0]!;
    if (add.type === "add_block") expect(add.topicId).toBe("topic-a");
  });

  it("is deterministic — the same response yields the same ids", () => {
    const raw = JSON.stringify({
      ops: [{ type: "add_block", topic: "topic-a", kind: "claim", text: "x", sources: [] }],
    });
    expect(parse(raw)).toEqual(parse(raw));
  });

  it("mints different ids under a different seed", () => {
    const raw = JSON.stringify({
      ops: [{ type: "add_block", topic: "topic-a", kind: "claim", text: "x", sources: [] }],
    });
    const a = parseExtractionResponse(raw, { idSeed: "seed-1" }).ops[0]!;
    const b = parseExtractionResponse(raw, { idSeed: "seed-2" }).ops[0]!;
    if (a.type === "add_block" && b.type === "add_block") {
      expect(a.blockId).not.toBe(b.blockId);
    }
  });

  it("parses every op type", () => {
    const result = parse(
      JSON.stringify({
        ops: [
          { type: "rename_topic", topic: "topic-a", title: "Better" },
          { type: "merge_topics", from: "topic-b", into: "topic-a" },
          { type: "retire_block", block: "block-1" },
          { type: "move_block", block: "block-2", topic: "topic-a" },
          {
            type: "revise_block",
            supersedes: "block-3",
            topic: "topic-a",
            kind: "claim",
            text: "Actually no.",
            sources: ["u3"],
          },
        ],
      }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.ops.map((o) => o.type)).toEqual([
      "rename_topic",
      "merge_topics",
      "retire_block",
      "move_block",
      "revise_block",
    ]);
  });

  /* --- robustness: a bad extraction must never wedge the queue ------------ */

  it("reports an error rather than throwing on unparseable output", () => {
    const result = parse("I'm sorry, I can't help with that.");
    expect(result.ops).toEqual([]);
    expect(result.error).toContain("no JSON");
  });

  it("reports an error on truncated JSON", () => {
    expect(parse('{"ops":[{"type":"add_bl').error).toBeTruthy();
  });

  it("reports an error when `ops` is missing", () => {
    expect(parse('{"result":"done"}').error).toContain("ops");
  });

  it("keeps the good ops and warns about the bad ones", () => {
    const result = parse(
      JSON.stringify({
        ops: [
          { type: "add_block", topic: "topic-a", kind: "claim", text: "keep me", sources: [] },
          { type: "add_block", topic: "topic-a", kind: "nonsense", text: "drop me" },
          { type: "teleport_block", block: "b" },
          { type: "add_block", kind: "claim", text: "no topic" },
        ],
      }),
    );

    expect(result.ops).toHaveLength(1);
    expect(result.warnings).toHaveLength(3);
    expect(result.error).toBeUndefined();
  });

  it("drops a merge of a topic into itself", () => {
    const result = parse(
      JSON.stringify({ ops: [{ type: "merge_topics", from: "t", into: "t" }] }),
    );
    expect(result.ops).toEqual([]);
    expect(result.warnings[0]).toContain("itself");
  });

  it("tolerates missing or malformed sources", () => {
    const result = parse(
      JSON.stringify({
        ops: [
          { type: "add_block", topic: "t", kind: "claim", text: "no sources" },
          { type: "add_block", topic: "t", kind: "claim", text: "bad sources", sources: "u1" },
        ],
      }),
    );

    expect(result.ops).toHaveLength(2);
    for (const o of result.ops) if (o.type === "add_block") expect(o.spans).toEqual([]);
  });
});

describe("PROMPT_VERSION discipline", () => {
  it("matches the recorded fingerprint of the prompt text", () => {
    // The cache is keyed on PROMPT_VERSION, so editing the prompt without
    // bumping it silently serves ops derived from the older wording — a bug
    // with no symptom until results look subtly wrong.
    //
    // When this fails: bump PROMPT_VERSION, then update the hash below.
    const fingerprint = createHash("sha256").update(SYSTEM_PROMPT).digest("hex").slice(0, 16);

    expect({ PROMPT_VERSION, fingerprint }).toEqual({
      PROMPT_VERSION: "2",
      fingerprint: "17350f55b1c8bc9b",
    });
  });
});
