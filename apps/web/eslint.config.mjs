// Next 16 removed `next lint`, so the Next rule sets are loaded through the
// ESLint CLI instead. eslint-config-next 16 exports flat-config arrays directly
// (`Linter.Config[]`), so no FlatCompat bridge is needed — and in fact one does
// not work here: routing these through @eslint/eslintrc throws on the circular
// plugin references in eslint-plugin-react.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    // Build output and Next's generated type shim are not ours to lint.
    ignores: [".next/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
