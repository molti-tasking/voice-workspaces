import { describe, expect, it } from "vitest";
import { StudyCondition, resolveStudyCondition } from "./contracts";

describe("StudyCondition", () => {
  /**
   * The promise the whole study rests on: switching conditions on changes
   * nothing until a field is written. If a default here drifts from what the
   * system does today, every "control" drive is silently something else.
   */
  it("resolves an empty or missing template to today's behaviour", () => {
    const today = { proactiveOffers: true, agendaOffers: false, voiceMacroOffers: false };
    expect(StudyCondition.parse({})).toEqual(today);
    expect(resolveStudyCondition(null)).toEqual({ ok: true, condition: today });
    expect(resolveStudyCondition(undefined)).toEqual({ ok: true, condition: today });
  });

  it("fills defaults around what the researcher wrote", () => {
    expect(resolveStudyCondition({ agendaOffers: true }).condition).toEqual({
      proactiveOffers: true,
      agendaOffers: true,
      voiceMacroOffers: false,
    });
  });

  it("refuses a misspelt field instead of quietly running the control arm", () => {
    const resolved = resolveStudyCondition({ agendaOffer: true });
    expect(resolved.ok).toBe(false);
    expect(resolved.condition.agendaOffers).toBe(false);
  });

  it("refuses a wrongly typed value without throwing", () => {
    expect(resolveStudyCondition({ proactiveOffers: "no" }).ok).toBe(false);
    expect(resolveStudyCondition("agenda").ok).toBe(false);
  });
});
