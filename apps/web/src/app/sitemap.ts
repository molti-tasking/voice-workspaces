import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * One entry, and that is not an oversight.
 *
 * Everything else in this app is either behind a session or deliberately
 * unindexed (the participant information sheet, which has an audience of about
 * nine people). Listing a URL a crawler cannot fetch is worse than omitting it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl("/").href,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
