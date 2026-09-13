// The rules every package shares, and nothing else.
//
// DELIBERATELY NOT A FORMATTER. Adopting Prettier here would have rewritten 168
// of 247 tracked files — the codebase is hand-formatted, the comments are
// wrapped by someone who was thinking about how they read, and a one-time
// reformat would bury that under churn and cost the git blame on most of the
// repo. These two rules touch import blocks and nothing else, so the diff is
// the change you asked for rather than the change plus everything around it.
//
// Both rules are AUTOFIXABLE: `pnpm lint:fix` sorts and prunes, and an editor
// with eslint-on-save does it as you type.
import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Build output, generated files, and things that are not ours. */
export const ignores = [
  "**/node_modules/**",
  "**/.next/**",
  "**/dist/**",
  "**/build/**",
  "**/drizzle/**",
  "**/__pycache__/**",
  "**/next-env.d.ts",
  "storage/**",
];

/**
 * The import order, which is the one this codebase already followed by hand.
 *
 * node builtins, then anything from npm, then our own workspace packages, then
 * the `@/` alias inside an app, then relative paths — outermost to innermost,
 * so reading a file's head tells you what it depends on in widening circles.
 * Encoded rather than merely observed, because a convention only a human
 * enforces is one that drifts the first busy week.
 */
export const importOrder = {
  groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
  pathGroups: [
    { pattern: "@voicemural/**", group: "internal", position: "before" },
    { pattern: "@/**", group: "internal", position: "after" },
  ],
  pathGroupsExcludedImportTypes: ["builtin"],
  "newlines-between": "ignore",
  alphabetize: { order: "asc", caseInsensitive: true },
};

/**
 * Just the two rules, with no TypeScript preset attached.
 *
 * `apps/web` needs this rather than `base`: `eslint-config-next/typescript`
 * already registers the `@typescript-eslint` plugin, and ESLint 9 refuses to
 * let a second config register the same plugin name — the whole lint run dies
 * with "Cannot redefine plugin". So web layers the rules it is missing onto the
 * presets it already has, and the packages, which have no presets at all, take
 * `base` below.
 */
export const importRules = [
  {
    plugins: {
      "import-x": importX,
      "unused-imports": unusedImports,
    },
    rules: {
      "import-x/order": ["warn", importOrder],

      /*
       * Unused imports are an ERROR and autofixed; unused local VARIABLES are a
       * warning and are not.
       *
       * The asymmetry is the point. Deleting an unused import is always safe —
       * the module is still there and nothing observable changes. Deleting an
       * unused variable can remove a side effect, or the one line that
       * documented why a value was destructured and ignored. So the tool prunes
       * the first and only points at the second.
       *
       * `_`-prefixed arguments are exempt, which is how this repo already
       * writes a deliberately ignored parameter.
       */
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // Superseded by the rule above, which knows the difference between an
      // import and a variable. Leaving both on double-reports every finding.
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
    },
  },
  {
    /*
     * `no-undef` OFF on TypeScript, which is what typescript-eslint itself
     * recommends.
     *
     * The compiler already rejects an undefined identifier, and it does so
     * knowing the type system: ESLint's copy of the rule does not, so it
     * reported 122 phantom errors here — every `NodeJS`, every DOM lib type,
     * every ambient declaration. A linter that cries wolf on a correct file is
     * worse than one rule fewer, because it trains you to run with warnings.
     */
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: { "no-undef": "off" },
  },
  {
    /*
     * The scripts in `scripts/` run under Node, and until now nothing linted
     * them at all — so ESLint did not know `process` or `console` existed and
     * reported 122 undefined globals across five files that work fine. Saying
     * where they run is the fix; turning the rule off would give up the one
     * check that is actually useful in a plain .mjs file.
     */
    files: ["**/*.mjs", "**/*.cjs", "scripts/**"],
    languageOptions: { globals: { ...globals.node } },
  },
];

/**
 * The full config, for the six packages and the worker — which had no linting
 * of any kind until now. They get the recommended JavaScript and TypeScript
 * sets as well, because a package nothing has ever linted is exactly where a
 * real finding is still sitting.
 */
export const base = [
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...importRules,
];

export default base;
