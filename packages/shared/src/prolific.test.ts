import { describe, expect, it } from "vitest";
import {
  ProlificClosing,
  ProlificEnroll,
  ProlificPart2,
  ProlificPid,
  chooseArm,
  isRealProlificPid,
  prolificCompletionUrl,
} from "./prolific";

describe("chooseArm", () => {
  it("fills the smaller arm", () => {
    expect(chooseArm({ control: 3, sparks: 2 }, () => 0)).toBe("sparks");
    expect(chooseArm({ control: 2, sparks: 3 }, () => 0.99)).toBe("control");
  });
  it("breaks a tie at random", () => {
    expect(chooseArm({ control: 4, sparks: 4 }, () => 0.2)).toBe("control");
    expect(chooseArm({ control: 4, sparks: 4 }, () => 0.7)).toBe("sparks");
  });
});

describe("PIDs", () => {
  it("accepts Prolific's and a researcher's, refuses anything that is not URL-safe", () => {
    expect(ProlificPid.safeParse("5f1c0a2b3c4d5e6f7a8b9c0d").success).toBe(true);
    expect(ProlificPid.safeParse("test-anton").success).toBe(true);
    expect(ProlificPid.safeParse("a b").success).toBe(false);
    expect(ProlificPid.safeParse("<script>").success).toBe(false);
    expect(ProlificPid.safeParse("abc").success).toBe(false);
  });
  it("tells a real PID from a test one", () => {
    expect(isRealProlificPid("5f1c0a2b3c4d5e6f7a8b9c0d")).toBe(true);
    expect(isRealProlificPid("test-anton")).toBe(false);
  });
});

describe("the contracts", () => {
  it("requires consent to enrol", () => {
    expect(ProlificEnroll.safeParse({ pid: "test-anton", consent: false }).success).toBe(false);
    expect(ProlificEnroll.safeParse({ pid: "test-anton", consent: true }).success).toBe(true);
  });

  it("refuses a free recall too short to mean anything", () => {
    const base = { step: "free_recall", pid: "test-anton", confidence: 4 };
    expect(ProlificPart2.safeParse({ ...base, text: "dunno" }).success).toBe(false);
    expect(
      ProlificPart2.safeParse({ ...base, text: "cooling centres, older people living alone, shade trees" }).success,
    ).toBe(true);
  });

  it("keeps the cards question null in the control arm", () => {
    const answers = { tookAway: 4, ownIdeas: 5, assistantThought: 3, cardsHelped: null, rehearsed: false };
    expect(ProlificClosing.safeParse(answers).success).toBe(true);
    expect(ProlificClosing.safeParse({ ...answers, tookAway: 8 }).success).toBe(false);
  });

  it("builds Prolific's completion URL", () => {
    expect(prolificCompletionUrl("C1A2B3")).toBe("https://app.prolific.com/submissions/complete?cc=C1A2B3");
  });
});
