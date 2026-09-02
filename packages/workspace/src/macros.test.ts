import { describe, expect, it } from "vitest";
import {
  buildMacroPrompt,
  canonicalise,
  mineRecurring,
  parseMacroResponse,
  type MinedDirective,
} from "./macros";

const BASE = new Date("2026-03-01T08:00:00Z").getTime();

function d(
  n: number,
  session: string,
  verb: string,
  object: string,
  minutes: number,
): MinedDirective {
  return {
    utteranceId: `u${n}`,
    captureSessionId: session,
    verb,
    object,
    text: `${verb} ${object}`,
    occurredAt: new Date(BASE + minutes * 60_000),
  };
}

describe("canonicalise", () => {
  it("collapses different phrasings of the same operation", () => {
    expect(canonicalise("mark", "the funding bit")).toBe(canonicalise("mark", "that funding question"));
  });

  it("keeps different objects apart", () => {
    expect(canonicalise("mark", "the funding")).not.toBe(canonicalise("mark", "the ethics form"));
  });

  it("tolerates an operation with no object", () => {
    expect(canonicalise("summarise", "")).toBe("summarise|");
  });
});

describe("mineRecurring", () => {
  it("offers nothing for an operation done once", () => {
    expect(mineRecurring([d(1, "s1", "mark", "the funding", 0)])).toEqual([]);
  });

  /**
   * The threshold that matters most. Three of anything in a single drive is
   * usually one episode — someone flagging three points in the same argument —
   * and reading that as a habit would propose a macro for a moment.
   */
  it("refuses a pattern confined to one session, however often it repeats", () => {
    const same = [
      d(1, "s1", "mark", "the funding", 0),
      d(2, "s1", "mark", "the funding", 5),
      d(3, "s1", "mark", "the funding", 10),
      d(4, "s1", "mark", "the funding", 15),
    ];
    expect(mineRecurring(same)).toEqual([]);
  });

  it("proposes an operation repeated across sessions", () => {
    const across = [
      d(1, "s1", "flag", "the risk", 0),
      d(2, "s2", "flag", "a risk", 1),
      d(3, "s3", "flag", "that risk", 2),
    ];
    const [candidate] = mineRecurring(across);
    expect(candidate?.canonicalForm).toBe("flag|risk");
    expect(candidate?.sessionCount).toBe(3);
    expect(candidate?.isSequence).toBe(false);
  });

  it("finds a pair that keeps happening together, and prefers it", () => {
    const pairs: MinedDirective[] = [];
    ["s1", "s2", "s3"].forEach((session, i) => {
      pairs.push(d(i * 2 + 1, session, "summarise", "the drive", i * 100));
      pairs.push(d(i * 2 + 2, session, "send", "the doc", i * 100 + 1));
    });
    const [first] = mineRecurring(pairs);
    expect(first?.isSequence).toBe(true);
    expect(first?.canonicalForm).toBe("summarise|drive>send|doc");
  });

  it("does not manufacture a sequence out of two distant instructions", () => {
    const far: MinedDirective[] = [];
    ["s1", "s2", "s3"].forEach((session, i) => {
      far.push(d(i * 2 + 1, session, "summarise", "the drive", i * 1000));
      far.push(d(i * 2 + 2, session, "send", "the doc", i * 1000 + 30));
    });
    expect(mineRecurring(far).every((c) => !c.isSequence)).toBe(true);
  });

  it("does not pair across a session boundary", () => {
    const straddling = [
      d(1, "s1", "summarise", "the drive", 0),
      d(2, "s2", "send", "the doc", 1),
      d(3, "s3", "summarise", "the drive", 2),
      d(4, "s4", "send", "the doc", 3),
    ];
    expect(mineRecurring(straddling).every((c) => !c.isSequence)).toBe(true);
  });
});

describe("buildMacroPrompt", () => {
  it("hands the model the verbatim lines and says how many sessions", () => {
    const [candidate] = mineRecurring([
      d(1, "s1", "flag", "the risk", 0),
      d(2, "s2", "flag", "a risk", 1),
      d(3, "s3", "flag", "that risk", 2),
    ]);
    const [, user] = buildMacroPrompt(candidate!);
    expect(user?.content).toContain("3 separate sessions");
    expect(user?.content).toContain('1. "flag the risk"');
  });
});

describe("parseMacroResponse", () => {
  const good = {
    name: "risks",
    restatement: "Pulls out anything you flagged as a risk.",
    markdown: "# risks\n\nCollect flagged risks.",
    params: { reversible: true, confirm: false },
  };

  it("reads a well-formed proposal", () => {
    expect(parseMacroResponse(JSON.stringify(good))).toMatchObject({
      name: "risks",
      params: { reversible: true, confirm: false },
    });
  });

  it("returns null rather than throwing on unusable output", () => {
    expect(parseMacroResponse("sorry, I can't")).toBeNull();
    expect(parseMacroResponse(JSON.stringify({ name: "x" }))).toBeNull();
  });

  /**
   * A capability nobody can say is a capability nobody can invoke, and the
   * whole path is eyes-free. Better no proposal than an unusable one.
   */
  it("rejects a name that is really a sentence", () => {
    expect(
      parseMacroResponse(
        JSON.stringify({ ...good, name: "pull out anything flagged as a risk" }),
      ),
    ).toBeNull();
  });

  it("accepts a two-word hyphenated name", () => {
    expect(parseMacroResponse(JSON.stringify({ ...good, name: "To Doc" }))?.name).toBe("to-doc");
  });

  /**
   * Defaulted rather than trusted: an author who forgot to say asks first, and
   * asking costs a question where guessing wrong costs a message the user never
   * meant to send.
   */
  it("makes an irreversible operation confirm even when the model said not to", () => {
    const out = parseMacroResponse(
      JSON.stringify({ ...good, params: { reversible: false, confirm: false } }),
    );
    expect(out?.params).toMatchObject({ reversible: false, confirm: true });
  });

  it("confirms by default when params are missing entirely", () => {
    const { params, ...rest } = good;
    void params;
    expect(parseMacroResponse(JSON.stringify(rest))?.params).toMatchObject({
      reversible: true,
      confirm: false,
    });
  });
});
