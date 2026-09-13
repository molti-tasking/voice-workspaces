// Next 16 removed `next lint`, so the Next rule sets are loaded through the
// ESLint CLI instead. eslint-config-next 16 exports flat-config arrays directly
// (`Linter.Config[]`), so no FlatCompat bridge is needed — and in fact one does
// not work here: routing these through @eslint/eslintrc throws on the circular
// plugin references in eslint-plugin-react.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// The same import-order and unused-import rules the packages use. Imported
// rather than restated, because a convention defined twice is one that drifts.
import { importRules } from "../../eslint.base.mjs";

const config = [
  {
    // Build output and Next's generated type shim are not ours to lint.
    ignores: [".next/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  // Last, so the shared rules win where Next's TypeScript preset also has an
  // opinion on unused variables — these turn that one off in favour of the rule
  // that can tell an import from a local. `importRules` rather than the full
  // base: Next already registers @typescript-eslint, and ESLint 9 refuses a
  // second registration of the same plugin.
  ...importRules,
];

export default config;
