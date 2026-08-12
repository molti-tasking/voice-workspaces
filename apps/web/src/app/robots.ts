import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, siteUrl } from "@/lib/site";

// The origin is read from the runtime environment, which does not exist during
// `next build` — prerendering this would bake localhost into production's
// robots.txt. Same reasoning in sitemap.ts.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_PATHS],
    },
    sitemap: siteUrl("/sitemap.xml").href,
    host: siteUrl().host,
  };
}
