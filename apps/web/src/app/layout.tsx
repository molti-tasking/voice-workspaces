import { ViewTransitions } from "next-view-transitions";
import { NavDirectionTracker } from "@/components/nav-link";
import type { Metadata, Viewport } from "next";
import { PostHogIdentity } from "./sign-in-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoiceMural",
  description: "A voice interface for thinking, with a repertoire that grows through use.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "VoiceMural",
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
        <PostHogIdentity />
        {children}
      </body>
    </html>
    </ViewTransitions>
  );
}
