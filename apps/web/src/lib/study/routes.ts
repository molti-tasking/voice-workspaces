/**
 * The Prolific study's pages (`/p` and below): standalone, with none of the
 * app around them. No drive bar, no recall card, no survey — a participant
 * must see only the study, and every other screen is a way out of it.
 */
export function isStudyRoute(pathname: string): boolean {
  return pathname === "/p" || pathname.startsWith("/p/");
}
