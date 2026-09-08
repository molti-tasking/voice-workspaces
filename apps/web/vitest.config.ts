import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `@/…` is a tsconfig path alias that Next resolves and vitest does not; the
// route tests import through it exactly as the routes do.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
