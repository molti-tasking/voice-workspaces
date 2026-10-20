import { describe, expect, it } from "vitest";
import { MIRROR_MAX_BULLET_CHARS, mirrorMessages, parseMirrorBullets } from "./mirror";

describe("the mirror's bullets", () => {
  it("shows the model who said what, under the topic", () => {
    const messages = mirrorMessages("Denmark", [
      { who: "user", text: "A long weekend, not too expensive." },
      { who: "agent", text: "Aarhus, Skagen or Copenhagen." },
    ]);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.content).toContain('Topic: "Denmark"');
    expect(messages[1]?.content).toContain("Person: A long weekend");
    expect(messages[1]?.content).toContain("Assistant: Aarhus, Skagen");
  });

  it("sends only the last lines of a long topic", () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ who: "user" as const, text: `line ${i}` }));
    const content = mirrorMessages("Long", lines)[1]?.content ?? "";
    expect(content).not.toContain("line 0\n");
    expect(content).toContain("line 39");
  });

  it("reads the JSON, fenced or bare, and keeps each side apart", () => {
    expect(parseMirrorBullets('{"you": ["Long weekend, cheap"], "ai": ["Aarhus: ARoS", "Skagen: two seas"]}')).toEqual({
      you: ["Long weekend, cheap"],
      ai: ["Aarhus: ARoS", "Skagen: two seas"],
    });
    expect(parseMirrorBullets('```json\n{"you": [], "ai": ["Train to Frederikshavn"]}\n```')).toEqual({
      you: [],
      ai: ["Train to Frederikshavn"],
    });
  });

  it("tidies points: no list marks, no full stops, three at most, the newest kept", () => {
    const bullets = parseMirrorBullets('{"you": ["- one.", "• two", "3. three", "four."], "ai": []}');
    expect(bullets).toEqual({ you: ["two", "three", "four"], ai: [] });
  });

  it("cuts a point that runs long at a word", () => {
    const long = "word ".repeat(40).trim();
    const [point] = parseMirrorBullets(JSON.stringify({ you: [long], ai: [] }))!.you;
    expect(point!.length).toBeLessThanOrEqual(MIRROR_MAX_BULLET_CHARS + 1);
    expect(point!.endsWith("…")).toBe(true);
  });

  it("gives null for anything that is not the object asked for", () => {
    expect(parseMirrorBullets("Here are the points: Aarhus, Skagen.")).toBeNull();
    expect(parseMirrorBullets("{not json}")).toBeNull();
    expect(parseMirrorBullets('{"summary": "Denmark"}')).toBeNull();
  });
});
