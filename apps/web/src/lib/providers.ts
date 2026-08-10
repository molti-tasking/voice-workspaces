/**
 * Social provider identity, shared by the server and the client.
 *
 * Deliberately its own module with no "use client" and no server imports. The
 * sign-in button is a client component and the landing page is a server
 * component, and both need these names — but exports of a "use client" module
 * become client references under RSC, so a plain function imported from there
 * into a server component is not safely callable. Keeping it neutral lets both
 * sides import the same source of truth.
 */
export type SocialProvider = "github" | "google";

const PROVIDER_NAMES: Record<SocialProvider, string> = {
  github: "GitHub",
  google: "Google",
};

/** Human name for a provider, so callers do not hand-write "GitHub" each time. */
export function providerName(provider: SocialProvider): string {
  return PROVIDER_NAMES[provider];
}
