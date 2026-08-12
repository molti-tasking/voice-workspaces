import { ViewTransitions } from "next-view-transitions";
import { NavDirectionTracker } from "@/components/nav-link";
import type { Metadata, Viewport } from "next";
import { PostHogIdentity } from "@/lib/analytics/identity";
import { PostHogPageview } from "@/lib/analytics/pageview";
import { ServiceWorker } from "@/components/service-worker";
import { SITE, siteUrl } from "@/lib/site";
import "./globals.css";

// The icons, the manifest and the social card are all picked up from their
// files — icon.svg, favicon.ico, apple-icon.png, manifest.ts, opengraph-image
// and twitter-image, all in this directory — so none of them is listed here.
export const metadata: Metadata = {
  // Without this, every canonical and og:url comes out as a relative path and
  // is dropped by anything that unfurls links.
  metadataBase: siteUrl(),
  title: {
    default: SITE.name,
    // Pages set a bare title ("Workspace") and get "Workspace — VoiceMural".
    template: `%s — ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  // No `alternates.canonical` here on purpose: a canonical in the root layout
  // is inherited verbatim, so every page would declare itself a duplicate of
  // the home page. The one indexable route sets its own.
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    url: "/",
    locale: "en",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.description,
  },
  // Times, session lengths and offsets read as phone numbers to iOS, which
  // then renders them as call links inside the transcript.
  formatDetection: { telephone: false, date: false, address: false },
  appleWebApp: {
    capable: true,
    title: SITE.name,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
  width: "device-width",
  initialScale: 1,
  // The recorder is operated at a glance in a car; accidental pinch-zoom on a
  // mounted phone is a nuisance rather than an accessibility win here.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // React 19 stable has no ViewTransition component (it is canary-only), so
    // the provider from next-view-transitions wraps App Router navigations in
    // document.startViewTransition instead. Browsers without the API navigate
    // normally and nothing errors.
    //
    // `data-nav` picks the direction the sheet moves; see globals.css. Defaulted
    // here so the first navigation already has one.
    <ViewTransitions>
      <html lang="en" data-nav="forward">
      <body className="min-h-dvh antialiased">
        <NavDirectionTracker />
        <ServiceWorker />
        <PostHogIdentity />
        <PostHogPageview />
        {children}
      </body>
    </html>
    </ViewTransitions>
  );
}
