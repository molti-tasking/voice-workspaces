/**
 * The one description of this site, shared by the page metadata, the web app
 * manifest, the sitemap and the social card. Kept in one place because these
 * four disagree the moment they are edited separately, and the disagreement is
 * invisible until someone pastes a link into Slack.
 */

export const SITE = {
  name: "VoiceMural",
  /** Used as the <title> of the landing page and as the social card heading. */
  title: "VoiceMural — think out loud while you drive",
  description:
    "A voice interface for thinking. VoiceMural listens while you are eyes-busy, keeps everything you said, and grows a repertoire of the things you ask it for.",
  /** One line, for the card and the manifest, where the long one will clip. */
  summary: "Capture thinking aloud; the repertoire grows through use.",
  locale: "en",
} as const;

/**
 * Absolute origin the site is served from, without a trailing slash.
 *
 * Reuses BETTER_AUTH_URL rather than introducing a second variable: it is
 * already documented as "the public origin", already has to match what the
 * browser asks for, and a second variable would be one more thing to get out of
 * step — with the failure showing up only in a crawler's canonical URL, where
 * nobody would look.
 *
 * Falls back rather than throwing, because this is also read during `next
 * build`, where no runtime environment exists yet.
 */
export function siteOrigin(): string {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** `siteOrigin()` as the URL that `metadataBase` and the sitemap both want. */
export function siteUrl(path = "/"): URL {
  return new URL(path, `${siteOrigin()}/`);
}

/**
 * Everything a signed-in person sees. None of it is reachable without a
 * session, so a crawler that follows a link here gets a redirect or a 404 —
 * saying so up front keeps that out of the crawl budget and out of the index.
 */
export const PRIVATE_PATHS = [
  "/api/",
  "/record",
  "/workspace",
  "/timeline",
  "/sessions/",
  "/offline",
] as const;
