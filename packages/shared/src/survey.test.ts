import { describe, expect, it } from "vitest";
import { PARTNER_KEYS, PartnerRatings } from "./survey";

describe("the thinking-partner ratings", () => {
  it("has one rating per listed item, so the page and the schema cannot drift", () => {
    expect(Object.keys(PartnerRatings.shape).sort()).toEqual([...PARTNER_KEYS].sort());
  });
});
