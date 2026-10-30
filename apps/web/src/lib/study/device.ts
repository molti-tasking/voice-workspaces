/**
 * Whether the study is open on a phone.
 *
 * The display study is about a phone glanced at while talking, so it runs on
 * phones only. In Prolific pilot run 1 (30 Oct 2026) two of nine people
 * opened it on a desktop: one gave up at the microphone, one moved to a phone
 * part way through. Prolific's device filter is the first gate; this is the
 * second, for whoever gets past it.
 *
 * A phone is a touch screen whose short side is at most `PHONE_SHORT_SIDE`
 * CSS pixels. Tablets are refused with desktops: the view is laid out for a
 * phone's width, and a tablet's is not what is being tested.
 */
export const PHONE_SHORT_SIDE = 600;

export interface DeviceTraits {
  /** `(pointer: coarse)`: the primary pointer is a finger. */
  pointerCoarse: boolean;
  /** The screen's shorter side, in CSS pixels. */
  screenShortSide: number;
}

export function isPhone({ pointerCoarse, screenShortSide }: DeviceTraits): boolean {
  return pointerCoarse && screenShortSide > 0 && screenShortSide <= PHONE_SHORT_SIDE;
}

/** The traits of the browser this runs in; null on the server. */
export function readDeviceTraits(): DeviceTraits | null {
  if (typeof window === "undefined") return null;
  const pointerCoarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const { width, height } = window.screen ?? { width: 0, height: 0 };
  return { pointerCoarse, screenShortSide: Math.min(width, height) };
}
