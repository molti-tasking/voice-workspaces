import { describe, expect, it } from "vitest";
import { EMPTY_CONVERSATION, applyMessage, type ConversationMessage } from "./conversation";
import { createSparkLedger } from "./spark-ledger";
import { subjectSignalsBody } from "./subject-signals";

describe("what leaves the phone about each subject", () => {
  const messages: ConversationMessage[] = [
    { type: "title", title: "SECRET subject", ordinal: 1 },
    { type: "user", id: "u1", text: "um maybe the SECRET plan", pauses: 2, pausesBefore: 1 },
    { type: "agent", id: "a1", text: "The SECRET plan holds." },
    { type: "state", ordinal: 1, settled: false },
  ];
  const conversation = messages.reduce((s, m) => applyMessage(s, m, 0), EMPTY_CONVERSATION);

  it("carries counts, the judgement and the sparks by ordinal, and never a title or a word", () => {
    const ledger = createSparkLedger();
    ledger.noteShown([{ kind: "unsure", ordinal: 1 }]);
    ledger.notePulled({ kind: "unsure", ordinal: 1 });
    const body = subjectSignalsBody("s-1", conversation, ledger.getSnapshot(), 0, true);
    expect(body.subjects).toEqual([
      expect.objectContaining({
        ordinal: 1,
        userWords: 4,
        agentWords: 4,
        pauses: 2,
        pausesBefore: 1,
        fillers: 1,
        hedges: 1,
        settled: false,
        sparksShown: ["unsure"],
        sparksPulled: ["unsure"],
        kept: false,
        keptVia: null,
        keptAt: null,
      }),
    ]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("says whether they kept a subject, how and when", () => {
    const kept = applyMessage(conversation, { type: "keep", ordinal: 1, kept: true, via: "voice" }, 5_000);
    const body = subjectSignalsBody("s-1", kept, createSparkLedger().getSnapshot(), 0, true);
    expect(body.subjects[0]).toMatchObject({ kept: true, keptVia: "voice", keptAt: 5_000 });
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
});
