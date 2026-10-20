import { describe, expect, it } from "vitest";
import {
  StudyCondition,
  freezeStudyCondition,
  localDate,
  resolveStudyCondition,
  sparkSelectionOn,
} from "./contracts";

describe("StudyCondition", () => {
  /**
   * The promise the whole study rests on: switching conditions on changes
   * nothing until a field is written. If a default here drifts from what the
   * system does today, every "control" drive is silently something else.
   */
  it("resolves an empty or missing template to today's behaviour", () => {
    const today = {
      proactiveOffers: true,
      agendaOffers: false,
      voiceMacroOffers: false,
      sparks: false,
      sparkSelection: "suggested",
      alternateStart: "suggested",
    };
    expect(StudyCondition.parse({})).toEqual(today);
    expect(resolveStudyCondition(null)).toEqual({ ok: true, condition: today });
    expect(resolveStudyCondition(undefined)).toEqual({ ok: true, condition: today });
  });

  it("fills defaults around what the researcher wrote", () => {
    expect(resolveStudyCondition({ agendaOffers: true }).condition).toEqual({
      proactiveOffers: true,
      agendaOffers: true,
      voiceMacroOffers: false,
      sparks: false,
      sparkSelection: "suggested",
      alternateStart: "suggested",
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

describe("sparkSelection: who picks the subjects a spark is offered on", () => {
  const TZ = "Europe/Copenhagen";
  const day = (iso: string) => new Date(iso);

  it("passes suggested and chosen through unchanged", () => {
    const at = day("2026-10-20T08:00:00Z");
    expect(sparkSelectionOn(StudyCondition.parse({}), at, TZ)).toBe("suggested");
    expect(sparkSelectionOn(StudyCondition.parse({ sparkSelection: "chosen" }), at, TZ)).toBe("chosen");
  });

  it("alternates day by day from the first day, starting with the named mode", () => {
    const condition = StudyCondition.parse({
      sparks: true,
      sparkSelection: "alternate",
      alternateFrom: "2026-10-20",
      alternateStart: "chosen",
    });
    expect(sparkSelectionOn(condition, day("2026-10-20T07:00:00Z"), TZ)).toBe("chosen");
    expect(sparkSelectionOn(condition, day("2026-10-21T07:00:00Z"), TZ)).toBe("suggested");
    expect(sparkSelectionOn(condition, day("2026-10-22T07:00:00Z"), TZ)).toBe("chosen");
    // Before the first day it still alternates, counting backwards.
    expect(sparkSelectionOn(condition, day("2026-10-19T07:00:00Z"), TZ)).toBe("suggested");
  });

  it("counts the study's calendar day, not UTC's", () => {
    const condition = StudyCondition.parse({
      sparkSelection: "alternate",
      alternateFrom: "2026-10-20",
      alternateStart: "suggested",
    });
    // 23:30 UTC on the 20th is already the 21st in Copenhagen.
    const lateEvening = day("2026-10-20T23:30:00Z");
    expect(localDate(lateEvening, TZ)).toBe("2026-10-21");
    expect(sparkSelectionOn(condition, lateEvening, TZ)).toBe("chosen");
    expect(sparkSelectionOn(condition, lateEvening, "UTC")).toBe("suggested");
  });

  it("freezes a drive to its day, so the stored condition is never alternate", () => {
    const condition = StudyCondition.parse({
      sparks: true,
      sparkSelection: "alternate",
      alternateFrom: "2026-10-20",
      alternateStart: "chosen",
    });
    const frozen = freezeStudyCondition(condition, day("2026-10-21T09:00:00Z"), TZ);
    expect(frozen.sparkSelection).toBe("suggested");
    // The rest is kept as written, so the drive still says how it got there.
    expect(frozen.alternateFrom).toBe("2026-10-20");
    expect(frozen.sparks).toBe(true);
  });

  it("refuses an alternation date that is not a date", () => {
    expect(resolveStudyCondition({ sparkSelection: "alternate", alternateFrom: "Monday" }).ok).toBe(false);
  });
});
