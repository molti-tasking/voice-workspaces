import { describe, expect, it } from "vitest";
import { EMPTY_CONVERSATION, applyMessage, type ConversationMessage } from "./conversation";
import { createSparkLedger, offerKey } from "./spark-ledger";

describe("the spark ledger", () => {
  it("remembers each kind shown per subject once, and notifies only on a change", () => {
    const ledger = createSparkLedger();
    let changes = 0;
    ledger.subscribe(() => changes++);
    ledger.noteShown([{ kind: "say_back", ordinal: 1 }]);
    ledger.noteShown([{ kind: "say_back", ordinal: 1 }]);
    ledger.noteShown([{ kind: "decide", ordinal: 1 }, { kind: "revisit", ordinal: 2 }]);
    expect(changes).toBe(2);
    expect([...ledger.getSnapshot().shown.get(1)!]).toEqual(["say_back", "decide"]);
  });

  it("keeps the first spark pulled for a subject: it is done for the drive", () => {
    const ledger = createSparkLedger();
    ledger.notePulled({ kind: "decide", ordinal: 3 });
    ledger.notePulled({ kind: "unsure", ordinal: 3 });
    expect(ledger.getSnapshot().pulled.get(3)).toBe("decide");
  });
});

describe("what the ledger offers", () => {
  const plain = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const conversation = (
    [
      { type: "title", title: "Intro" },
      { type: "user", id: "u1", text: plain(10) },
      { type: "agent", id: "a1", text: plain(50) },
    ] as ConversationMessage[]
  ).reduce((state, message) => applyMessage(state, message, 0), EMPTY_CONVERSATION);

  it("offers the sparks the rules find, and notifies only when the offer changes", () => {
    const ledger = createSparkLedger();
    let changes = 0;
    ledger.subscribe(() => changes++);
    ledger.refresh(conversation, 0);
    ledger.refresh(conversation, 0);
    expect(offerKey(ledger.getSnapshot().offered)).toBe("1:say_back");
    expect(changes).toBe(1);
  });

  it("takes a pulled spark off the offer at once, and does not bring it back", () => {
    const ledger = createSparkLedger();
    ledger.refresh(conversation, 0);
    ledger.notePulled({ kind: "say_back", ordinal: 1 });
    expect(ledger.getSnapshot().offered).toEqual([]);
    ledger.refresh(conversation, 0);
    expect(ledger.getSnapshot().offered).toEqual([]);
  });
});
