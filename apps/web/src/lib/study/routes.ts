/**
 * The study pages a participant sees: the Prolific study's (`/p` and below)
 * and the display study's session (`/study/session`). Standalone, with none
 * of the app around them. No drive bar, no recall card, no survey — a
 * participant must see only the study, and every other screen is a way out
 * of it.
 */
export function isStudyRoute(pathname: string): boolean {
  return pathname === "/p" || pathname.startsWith("/p/") || pathname.startsWith("/study/session");
}
