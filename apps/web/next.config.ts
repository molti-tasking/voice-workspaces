import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// Next only looks for .env beside the app, but this is a monorepo and the
// single source of truth lives at the repo root. In production Coolify injects
// the variables directly and no file is present.
loadEnv({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });

const config: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build artefact,
  // so Next compiles them directly. This removes a per-package build step and
  // the ordering problems that come with it.
  transpilePackages: [
    "@voicemural/db",
    "@voicemural/llm",
    "@voicemural/shared",
    "@voicemural/workspace",
  ],
  serverExternalPackages: ["postgres"],
  experimental: {
    serverActions: {
      // Chunks are ~5s of Opus (tens of KB), but a long chunk from a slow
      // upload retry can be larger. Generous ceiling, still far from unbounded.
      bodySizeLimit: "25mb",
    },
  },
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};

export default config;
