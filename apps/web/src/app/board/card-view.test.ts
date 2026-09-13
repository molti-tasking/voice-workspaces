/**
 * The marker line, which is the sentence the board exists to show.
 *
 * "you moved it back" versus "you moved it on" is the distinction the study
 * turns on, and it is decided by comparing the person's move against the
 * transition BEFORE it — not against where the card ended up. That is easy to
 * get subtly wrong and impossible to notice by looking at the page, so it is
 * tested here rather than left inside a component.
 *
 * Pure: no database, no fold, no React.
 */
import { describe, expect, it } from "vitest";
import type { BoardCard, JudgedTransition, TaskTransition } from "@voicemural/workspace";
import { markerFor, toCardView } from "./card-view";

const AT = new Date("2026-09-14T08:00:00Z");

function transition(over: Partial<TaskTransition> = {}): TaskTransition {
  return {
    cardId: "card-1",
    blockId: "block-1",
    from: "next",
    to: "done",
    at: AT,
    seq: 1,
    via: "speech",
    sourceUtteranceIds: [],
    ...over,
  };
}

function card(over: Partial<BoardCard> = {}): BoardCard {
  const last = over.lastTransition ?? transition();
  return {
    cardId: "card-1",
    state: "done",
    staleSessions: 0,
    lastTransition: last,
    history: over.history ?? [last],
    block: {
      id: "block-1",
      topicId: "t",
      kind: "task",
      text: "Email William.",
      state: "done",
      spans: [{ utteranceId: "u1" }],
      occurredAt: AT,
    } as BoardCard["block"],
    topic: { id: "t", title: "Research stay", icon: "compass" } as BoardCard["topic"],
    ...over,
  };
}

describe("markerFor", () => {
  it("says speech moved it, while the verdict is still pending", () => {
    expect(markerFor(card())).toBe("moved here by speech");
  });

  it("adds 'kept' once enough drives have passed untouched", () => {
    const outcome = { transition: transition(), outcome: "kept" } as JudgedTransition;
    expect(markerFor(card(), outcome)).toBe("moved here by speech · kept");
  });

  it("is silent on a card speech only ever added", () => {
    // `from: null` is the first add. Nothing moved, so there is nothing to say.
    expect(markerFor(card({ lastTransition: transition({ from: null, to: "open" }) }))).toBeNull();
  });

  it("calls it back when the person returns it to where speech found it", () => {
    const speech = transition({ from: "next", to: "done", via: "speech", seq: 1 });
    const user = transition({ from: "done", to: "next", via: "user", seq: 2 });
    expect(markerFor(card({ lastTransition: user, history: [speech, user], state: "next" }))).toBe(
      "you moved it back",
    );
  });

  it("calls it on when the person moves it somewhere else entirely", () => {
    // Speech said next→done; the person said dropped. Not a reversal — the
    // measurement counts this separately, and the card must not claim it is one.
    const speech = transition({ from: "next", to: "done", via: "speech", seq: 1 });
    const user = transition({ from: "done", to: "dropped", via: "user", seq: 2 });
    expect(
      markerFor(card({ lastTransition: user, history: [speech, user], state: "dropped" })),
    ).toBe("you moved it on");
  });

  it("says 'you moved it' when the person's move is the card's first transition", () => {
    const user = transition({ from: "open", to: "doing", via: "user", seq: 2 });
    expect(markerFor(card({ lastTransition: user, history: [user], state: "doing" }))).toBe(
      "you moved it",
    );
  });

  it("still says 'on' when the only prior transition was speech ADDING the card", () => {
    /*
     * Pins existing behaviour rather than endorsing it. The speech branch above
     * treats an add (`from: null`) as "not a move" and stays silent; this branch
     * does not, so a person moving a freshly-added card reads "you moved it on"
     * — on from nowhere. Carried over verbatim from the server component this
     * replaced, because changing what the board tells a participant is a study
     * decision, not a refactor. Flagged for Anton.
     */
    const add = transition({ from: null, to: "open", via: "speech", seq: 1 });
    const user = transition({ from: "open", to: "doing", via: "user", seq: 2 });
    expect(markerFor(card({ lastTransition: user, history: [add, user], state: "doing" }))).toBe(
      "you moved it on",
    );
  });

  it("appends the stale count, and stands alone when there is nothing else", () => {
    expect(markerFor(card({ staleSessions: 3 }))).toBe("moved here by speech · untouched for 3 drives");

    const add = transition({ from: null, to: "open" });
    expect(markerFor(card({ lastTransition: add, staleSessions: 2 }))).toBe(
      "untouched for 2 drives",
    );
  });

  it("stays quiet at one stale drive — one commute is easy to miss", () => {
    expect(markerFor(card({ staleSessions: 1 }))).toBe("moved here by speech");
  });
});

describe("toCardView", () => {
  it("carries the head block id, which is what a move must be aimed at", () => {
    // Not the cardId: that is the root of the revision chain and no longer
    // names a block the route can revise.
    const view = toCardView(card());
    expect(view.cardId).toBe("card-1");
    expect(view.blockId).toBe("block-1");
  });

  it("formats the date and leaves nothing unserialisable to cross to the client", () => {
    const view = toCardView(card());
    expect(typeof view.said).toBe("string");
    expect(view.spanCount).toBe(1);
    // Round-trips through JSON unchanged: no Dates, no class instances, and
    // none of the fold's history.
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
