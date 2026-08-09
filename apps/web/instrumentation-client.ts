import posthog from "posthog-js";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

/**
 * Analytics is optional, in the same way GitHub sign-in is.
 *
 * A fresh clone has to run with nothing but a database — that is the point of
 * `scripts/check-dev.mjs` and of building auth lazily. Throwing here when the
 * token is missing would make a PostHog project a prerequisite for `pnpm dev`,
 * so an unconfigured environment warns once and carries on.
 */
if (!projectToken || !apiHost) {
  if (process.env.NODE_ENV === "development") {
    console.warn(
      "PostHog is not configured (NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN / NEXT_PUBLIC_POSTHOG_HOST). Analytics is disabled for this session.",
    );
  }
} else {
  posthog.init(projectToken, {
    api_host: apiHost,

    // Pins the behaviour of every option not named below, so a posthog-js
    // upgrade cannot silently change what is collected mid-study.
    defaults: "2026-01-30",

    // Overrides `defaults`, which sets `identified_only`. Profiles for
    // anonymous visitors too, so the landing page is part of the funnel rather
    // than a blind spot. Must come after `defaults` to win.
    person_profiles: "always",

    // Pageviews are sent by hand from `<PostHogPageview>`. Automatic capture
    // keys off history changes, and the timeline pages itself in by calling
    // router.replace('/timeline?sessions=N') on every infinite-scroll step —
    // which would bill a fresh pageview for each scroll and shatter the
    // /timeline funnel into a dozen query-string variants.
    capture_pageview: false,
    capture_pageleave: true,

    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },

    // Adds X-POSTHOG-SESSION-ID / X-POSTHOG-DISTINCT-ID to same-origin fetches,
    // which is what lets a server event be lined up with the replay it
    // happened during.
    tracing_headers: [window.location.hostname],

    // Started per route instead, so /record is never recorded — it is a static
    // timer on a phone in a cradle, and recording it burns a participant's
    // mobile data for a video of a number changing. See <PostHogPageview>.
    disable_session_recording: true,

    session_recording: {
      // The app has almost no <input> elements, so `maskAllInputs` would
      // protect nothing. What is on screen is the participant's own transcribed
      // speech, across /timeline, /workspace and /sessions/[id]. Masking text
      // is the only setting that actually covers it.
      maskAllInputs: true,
      maskTextSelector: "*",
    },

    debug: process.env.NODE_ENV === "development",
  });
}
