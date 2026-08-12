import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

/**
 * The image a link to this site unfurls into, in Slack, iMessage, X and
 * anywhere else that reads Open Graph tags. Rendered rather than committed as a
 * PNG so it stays in step with `lib/site.ts`.
 *
 * Shared by opengraph-image and twitter-image, which want the same picture and
 * differ only in the tag they end up in.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = SITE.title;

/** The mark from scripts/generate-icons.mjs, in the proportions it draws. */
const BARS = [156, 320, 240, 112].map((h) => (h / 320) * 190);

export function socialCard() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0f1115",
          color: "#f7f7f5",
          padding: "0 90px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          {BARS.map((h, i) => (
            <div
              key={i}
              style={{
                width: 38,
                height: h,
                borderRadius: 19,
                background: "#e5484d",
              }}
            />
          ))}
        </div>
        <div
          style={{
            marginTop: 56,
            fontSize: 76,
            fontWeight: 600,
            letterSpacing: -2,
          }}
        >
          {SITE.name}
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 34,
            lineHeight: 1.35,
            color: "#f7f7f5",
            opacity: 0.6,
            maxWidth: 820,
          }}
        >
          Think out loud while you drive. It listens, keeps what you said, and
          learns what you keep asking it for.
        </div>
      </div>
    ),
    size,
  );
}
