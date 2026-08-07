import type { Metadata, Viewport } from "next";
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
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
