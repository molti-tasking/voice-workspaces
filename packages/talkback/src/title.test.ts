import { describe, expect, it } from "vitest";
import { SETTLED_PROMPT, TITLE_PROMPT, cleanTitle, parseSettled, settledMessages, titleMessages } from "./title";

/** Ported with `clean_title` and `parse_settled` from bot.py, and their tests. */

describe("cleanTitle", () => {
  it("strips what a board cannot show", () => {
    expect(cleanTitle('"Funding round."', null)).toBe("Funding round");
    expect(cleanTitle("**Tuesday deadline**", null)).toBe("Tuesday deadline");
    expect(cleanTitle("  Split   flap  board \n", null)).toBe("Split flap board");
  });

  it("caps at four words and thirty-two characters, cut at a word", () => {
    expect(cleanTitle("one two three four five", null)).toBe("one two three four");
    expect(cleanTitle("Immunotherapy reimbursement negotiation timeline", null)).toBe("Immunotherapy reimbursement");
  });

  it("reports nothing to change", () => {
    expect(cleanTitle(null, "Funding round")).toBeNull();
    expect(cleanTitle("   ", "Funding round")).toBeNull();
    expect(cleanTitle("NONE", null)).toBeNull();
    expect(cleanTitle("Funding round", "Funding round")).toBeNull();
    expect(cleanTitle("FUNDING ROUND", "Funding round")).toBeNull();
  });
});

describe("parseSettled", () => {
  it("reads the answer however it is dressed", () => {
    expect(parseSettled("SETTLED")).toBe(true);
    expect(parseSettled(" open.")).toBe(false);
    expect(parseSettled("**Settled**")).toBe(true);
    for (const raw of [null, "", "maybe", "NOT SETTLED"]) expect(parseSettled(raw)).toBeNull();
  });
});

describe("the messages", () => {
  it("ask for a title the way the container did", () => {
    expect(titleMessages(null, [], "we should take the train")).toEqual([
      { role: "system", content: TITLE_PROMPT },
      { role: "user", content: "Current title: (none yet)\n\nRecent speech:\nwe should take the train" },
    ]);
    expect(titleMessages("Train to Odense", ["Budget"], "or the bus")[1]!.content).toBe(
      "Current title: Train to Odense\n\nEarlier titles: Budget\n\nRecent speech:\nor the bus",
    );
  });

  it("ask whether a subject was settled on its own speech", () => {
    expect(settledMessages("Budget", "150 each, fine")).toEqual([
      { role: "system", content: SETTLED_PROMPT },
      { role: "user", content: "Subject: Budget\n\nWhat was said:\n150 each, fine" },
    ]);
  });
});
