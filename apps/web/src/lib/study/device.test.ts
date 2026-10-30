import { describe, expect, it } from "vitest";
import { PHONE_SHORT_SIDE, isPhone } from "./device";

describe("isPhone", () => {
  it("takes a touch screen with a phone's short side", () => {
    expect(isPhone({ pointerCoarse: true, screenShortSide: 390 })).toBe(true);
    expect(isPhone({ pointerCoarse: true, screenShortSide: PHONE_SHORT_SIDE })).toBe(true);
  });

  it("refuses desktops, tablets and a screen it could not measure", () => {
    // Pilot run 1: a Mac and a Windows PC.
    expect(isPhone({ pointerCoarse: false, screenShortSide: 900 })).toBe(false);
    // A desktop browser narrowed to a phone's width is still a desktop.
    expect(isPhone({ pointerCoarse: false, screenShortSide: 390 })).toBe(false);
    expect(isPhone({ pointerCoarse: true, screenShortSide: 820 })).toBe(false);
    expect(isPhone({ pointerCoarse: true, screenShortSide: 0 })).toBe(false);
  });
});
