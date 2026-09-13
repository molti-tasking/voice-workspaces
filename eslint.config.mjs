// Root config: the packages and the worker, which had no linting at all.
//
// `apps/web` keeps its own config — ESLint resolves the nearest one, and the
// Next rule sets have to be layered there. It imports the same base, so the two
// cannot drift on import order.
import base from "./eslint.base.mjs";

export default [
  { ignores: ["apps/web/**"] },
  ...base,
];
