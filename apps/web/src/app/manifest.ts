import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * The web app manifest, which is what turns this into something you install on
 * a phone rather than a tab you have to find again in a car park.
 *
 * Generated rather than kept as a static file so it cannot drift from
 * `lib/site.ts`, and so Next injects the <link rel="manifest"> itself.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Pinning the id means a later change to start_url does not read as a
    // different app and leave people with two launcher icons.
    id: "/",
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.summary,
    // The installed icon exists to be tapped before setting off, so it opens
    // the recorder rather than the session list. Signed-out visitors are
    // redirected to the landing page from there.
    start_url: "/record",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    // A phone in a windscreen cradle is portrait, and a rotation mid-drive is
    // one more thing moving in the corner of your eye.
    orientation: "portrait",
    background_color: "#0f1115",
    theme_color: "#0f1115",
    lang: SITE.locale,
    dir: "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Android crops a launcher icon to whatever shape the device uses, so the
      // maskable pair is full-bleed with the mark pulled into the safe circle.
      // Declaring the `any` icons as maskable too — which the old manifest did
      // — gets the waveform's outer bars sliced off on a circular mask.
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Start recording",
        short_name: "Record",
        url: "/record",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Workspace",
        short_name: "Workspace",
        url: "/workspace",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Timeline",
        short_name: "Timeline",
        url: "/timeline",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
