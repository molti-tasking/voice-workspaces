import { describe, expect, it } from "vitest";
import { isResearcher, researcherIds } from "./researchers";

describe("isResearcher", () => {
  it("lets nobody in when the list is unset or empty", () => {
    expect(isResearcher("u1", {})).toBe(false);
    expect(isResearcher("u1", { RESEARCHER_USER_IDS: "" })).toBe(false);
    expect(isResearcher("u1", { RESEARCHER_USER_IDS: " , " })).toBe(false);
  });

  it("lets in exactly the listed ids, spaces and all", () => {
    const env = { RESEARCHER_USER_IDS: " u1 , u2" };
    expect(researcherIds(env)).toEqual(new Set(["u1", "u2"]));
    expect(isResearcher("u1", env)).toBe(true);
    expect(isResearcher("u2", env)).toBe(true);
    expect(isResearcher("u3", env)).toBe(false);
  });

  it("never lets in someone without a session", () => {
    const env = { RESEARCHER_USER_IDS: "u1" };
    expect(isResearcher(null, env)).toBe(false);
    expect(isResearcher(undefined, env)).toBe(false);
    expect(isResearcher("", env)).toBe(false);
  });
});
