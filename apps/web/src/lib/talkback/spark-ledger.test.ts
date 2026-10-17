import { describe, expect, it } from "vitest";
import { createSparkLedger } from "./spark-ledger";

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
