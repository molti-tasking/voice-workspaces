import { describe, expect, it } from "vitest";
import { spokenLine, spokenPage, spokenWords } from "./spoken";

const reply = "Nice plan! The train is cheaper for four. Shall we look at hostels next?";
/** Characters up to and including the end of `word`'s first occurrence. */
const upTo = (word: string) => reply.indexOf(word) + word.length;
const texts = (words: { text: string }[]) => words.map((w) => w.text).join(" ");
const said = (words: { text: string; said: boolean }[]) => texts(words.filter((w) => w.said));

describe("spokenWords", () => {
  it("marks each word said once the voice has reached it, and all of them without a voice", () => {
    const words = spokenWords(reply, upTo("train"));
    expect(said(words)).toBe("Nice plan! The train");
    expect(words.find((w) => w.text === "is")).toMatchObject({ said: false, start: reply.indexOf(" is") + 1 });
    expect(spokenWords(reply).every((w) => w.said)).toBe(true);
    expect(spokenWords("   ")).toEqual([]);
  });
});

describe("spokenLine", () => {
  it("lays out the sentence being said whole, and nothing after it", () => {
    const line = spokenLine(reply, upTo("train"));
    expect(texts(line)).toBe("Nice plan! The train is cheaper for four.");
    expect(said(line)).toBe("Nice plan! The train");
  });

  it("reserves the next sentence in the pause before the voice says it", () => {
    expect(texts(spokenLine(reply, upTo("four.")))).toBe(reply);
    expect(texts(spokenLine(reply, upTo("plan!")))).toBe("Nice plan! The train is cheaper for four.");
  });

  it("is the whole turn once the voice is done, or without one", () => {
    expect(texts(spokenLine(reply))).toBe(reply);
    expect(spokenLine(reply).every((w) => w.said)).toBe(true);
  });
});

describe("spokenPage", () => {
  it("shows the sentence being said as a page, kept until the next one's first word", () => {
    expect(spokenPage(reply, upTo("plan!"), 14)).toMatchObject({ cut: false, midSentence: false });
    expect(texts(spokenPage(reply, upTo("plan!"), 14).words)).toBe("Nice plan!");
    // The sentence is finished, the next not begun: still on screen to be read.
    expect(texts(spokenPage(reply, upTo("four."), 14).words)).toBe("The train is cheaper for four.");
    const next = spokenPage(reply, upTo("Shall"), 14);
    expect(texts(next.words)).toBe("Shall we look at hostels next?");
    expect(said(next.words)).toBe("Shall");
    expect(next.cut).toBe(true);
  });

  it("cuts a long sentence into fixed pages rather than sliding along it", () => {
    const long = "one two three four five six seven eight nine ten.";
    const first = spokenPage(long, long.indexOf("four") + 4, 4);
    expect(texts(first.words)).toBe("one two three four");
    // The fifth word turns the page whole; it does not shift by one.
    const second = spokenPage(long, long.indexOf("five") + 4, 4);
    expect(second).toMatchObject({ midSentence: true, cut: true });
    expect(texts(second.words)).toBe("five six seven eight");
  });

  it("is the last page once the voice is done, and the first before it starts", () => {
    expect(texts(spokenPage(reply, undefined, 14).words)).toBe("Shall we look at hostels next?");
    expect(texts(spokenPage(reply, 0, 14).words)).toBe("Nice plan!");
  });
});
