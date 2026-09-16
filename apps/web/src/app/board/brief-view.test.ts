/**
 * The link shapes and the step wording, tested away from the pages that draw
 * them.
 *
 * `asOf` is the reason this file exists. A brief read as of last Tuesday that
 * linked to today's board would be two views of one ledger disagreeing on the
 * same screen, and the only way to notice is to check every link — which is
 * what this does.
 *
 * Pure: no database, no React.
 */
import { describe, expect, it } from "vitest";
import type { CardStep, TaskTransition } from "@voicemural/workspace";
import { cardHref, stepLabel, transcriptHref, withAsOf } from "./brief-view";

const AS_OF = new Date("2026-09-14T08:00:00Z");

function step(over: Partial<CardStep> = {}): CardStep {
  return {
    block: { id: "b1", topicId: "t", kind: "task", text: "Email William.", spans: [], occurredAt: AS_OF },
    via: "speech",
    utteranceIds: [],
    ...over,
  } as CardStep;
}

function transition(over: Partial<TaskTransition> = {}): TaskTransition {
  return {
    cardId: "b1",
    blockId: "b1",
    from: "next",
    to: "done",
    at: AS_OF,
    seq: 1,
    via: "speech",
    sourceUtteranceIds: [],
    ...over,
  };
}

describe("withAsOf", () => {
  it("leaves the path alone when the scrubber is at now", () => {
    expect(withAsOf("/board")).toBe("/board");
  });

  it("carries the cursor, encoded", () => {
    expect(withAsOf("/board/brief", AS_OF)).toBe(
      "/board/brief?asOf=2026-09-14T08%3A00%3A00.000Z",
    );
  });
});

describe("cardHref", () => {
  it("points at the card's own page, keeping the cursor", () => {
    expect(cardHref("b1")).toBe("/board/cards/b1");
    expect(cardHref("b1", AS_OF)).toBe("/board/cards/b1?asOf=2026-09-14T08%3A00%3A00.000Z");
  });

  it("encodes an id that is not url-safe", () => {
    expect(cardHref("a/b")).toBe("/board/cards/a%2Fb");
  });
});

describe("transcriptHref", () => {
  it("jumps to the line when one is named, and to the drive when not", () => {
    expect(transcriptHref("s1", "u1")).toBe("/sessions/s1#u-u1");
    expect(transcriptHref("s1")).toBe("/sessions/s1");
  });
});

describe("stepLabel", () => {
  it("names the column a card was added to", () => {
    expect(stepLabel(step({ transition: transition({ from: null, to: "next" }) }))).toBe(
      "added to next · by speech",
    );
  });

  it("names both columns of a move, and who made it", () => {
    expect(stepLabel(step({ via: "user", transition: transition({ via: "user" }) }))).toBe(
      "next → done · by you",
    );
    expect(stepLabel(step({ via: "agent", transition: transition({ via: "agent" }) }))).toBe(
      "next → done · by the agent",
    );
  });

  it("tells a rewording from the task simply coming up again", () => {
    // Both are revises that did not move the card, and reading them as one
    // would make a sharpened wording look like silence.
    expect(stepLabel(step({ previousText: "Email Will." }))).toBe("reworded · by speech");
    expect(stepLabel(step())).toBe("mentioned again · by speech");
  });
});
