import { describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "../conversation";
import { Titler, type TitlerIO, type Visit } from "./titler";

/** The rules of `TopicTitle` in bot.py, which the views' sections depend on. */

function harness(answers: (string | null)[], seeded: { title: string; ordinal?: number }[] = []) {
  let clock = 10_000;
  const emitted: ConversationMessage[] = [];
  const visits: Visit[] = [];
  const saved: string[] = [];
  const asked: { current: string | null; earlier: readonly string[]; recent: string }[] = [];
  const judged: string[] = [];
  const io: TitlerIO = {
    now: () => clock,
    name: async (current, earlier, recent) => {
      asked.push({ current, earlier, recent });
      return answers.shift() ?? null;
    },
    judge: async (title) => {
      judged.push(title);
      return true;
    },
    emit: (m) => emitted.push(m),
    saveTitle: (t) => saved.push(t),
    saveVisit: (v) => visits.push(v),
  };
  const titler = new Titler(io, 0, seeded);
  return {
    titler,
    emitted,
    visits,
    saved,
    asked,
    judged,
    at: (ms: number) => {
      clock = ms;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Titler", () => {
  it("names the subject once a finished turn of theirs says enough, from the turn that began it", async () => {
    const h = harness(["Weekend in Odense"]);
    h.titler.began("item_u1");
    h.at(12_000);
    h.titler.heard("user", "yes");
    expect(h.asked).toHaveLength(0);
    h.titler.heard("user", "we could take the train to Odense for the weekend");
    await flush();
    expect(h.asked[0]).toMatchObject({ current: null, earlier: [] });
    expect(h.emitted).toEqual([{ type: "title", title: "Weekend in Odense", ordinal: 1, rehomeFrom: "item_u1" }]);
    expect(h.saved).toEqual(["Weekend in Odense"]);
    // The first title names everything said before it: from their first words.
    expect(h.visits).toEqual([{ ordinal: 1, title: "Weekend in Odense", startOffsetMs: 10_000 }]);
  });

  it("brings a subject back under its old title and ordinal, and judges the one left", async () => {
    const h = harness(["Weekend in Odense", "Budget", "weekend in odense"]);
    h.titler.heard("user", "we could take the train to Odense for the weekend");
    await flush();
    h.at(40_000);
    h.titler.began("item_u2");
    h.titler.heard("user", "but we only have a hundred and fifty euros each");
    await flush();
    h.at(70_000);
    h.titler.began("item_u3");
    h.titler.heard("user", "so back to Odense then, the train is cheap");
    await flush();

    expect(h.emitted.filter((m) => m.type === "title")).toEqual([
      { type: "title", title: "Weekend in Odense", ordinal: 1 },
      { type: "title", title: "Budget", ordinal: 2, rehomeFrom: "item_u2" },
      { type: "title", title: "Weekend in Odense", ordinal: 1, rehomeFrom: "item_u3" },
    ]);
    expect(h.asked[2]!.earlier).toEqual(["Weekend in Odense"]);
    expect(h.judged).toEqual(["Weekend in Odense", "Budget"]);
    expect(h.emitted.filter((m) => m.type === "state")).toEqual([
      { type: "state", ordinal: 1, settled: true },
      { type: "state", ordinal: 2, settled: true },
    ]);
    expect(h.visits).toContainEqual({ ordinal: 1, title: "Weekend in Odense", startOffsetMs: 10_000, endOffsetMs: 40_000 });
    expect(h.visits).toContainEqual({ ordinal: 2, title: "Budget", startOffsetMs: 40_000, endOffsetMs: 70_000 });
  });

  it("shows the model the agent's words, and never names on them alone", async () => {
    const h = harness(["Train tickets"]);
    h.titler.heard("agent", "Odense is an hour away by train, and tickets are cheap if booked early.");
    expect(h.asked).toHaveLength(0);
    h.titler.heard("user", "okay so we book the tickets now");
    await flush();
    expect(h.asked[0]!.recent).toBe(
      "(you said) Odense is an hour away by train, and tickets are cheap if booked early. okay so we book the tickets now",
    );
  });

  it("asks once at a time, and once more for a turn that ended while it asked", async () => {
    let resolve: (title: string | null) => void = () => undefined;
    const h = harness([]);
    const name = vi.fn(() => new Promise<string | null>((r) => (resolve = r)));
    (h.titler as unknown as { io: TitlerIO }).io.name = name;
    h.titler.heard("user", "we could take the train to Odense for the weekend");
    h.titler.heard("user", "or maybe drive there instead, it is not far");
    expect(name).toHaveBeenCalledTimes(1);
    resolve("Odense trip");
    await flush();
    expect(name).toHaveBeenCalledTimes(2);
  });

  it("starts from the sections a reconnect hands over, and keeps a rename", async () => {
    const h = harness(["Budget"], [
      { title: "Weekend in Odense", ordinal: 1 },
      { title: "Packing", ordinal: 2 },
    ]);
    expect(h.titler.titleFor(2)).toBe("Packing");
    expect(h.titler.rename(1, "Our Odense trip")).toBe(true);
    expect(h.titler.rename(2, "Our Odense trip")).toBe(false);
    h.titler.heard("user", "how much will all of this cost us in the end");
    await flush();
    expect(h.asked[0]).toMatchObject({ current: "Packing", earlier: ["Our Odense trip"] });
    expect(h.emitted.find((m) => m.type === "title")).toMatchObject({ type: "title", title: "Budget", ordinal: 3 });
    // The subject it was on when the connection came back is judged when left,
    // on what was said since.
    expect(h.judged).toEqual(["Packing"]);
  });

  it("records nothing once closed", async () => {
    const h = harness(["Budget"]);
    h.titler.heard("user", "how much will all of this cost us in the end");
    await flush();
    h.at(20_000);
    h.titler.close();
    h.titler.heard("user", "and another thing about the hotel prices");
    await flush();
    expect(h.visits.at(-1)).toEqual({ ordinal: 1, title: "Budget", startOffsetMs: 10_000, endOffsetMs: 20_000 });
    expect(h.asked).toHaveLength(1);
  });
});
