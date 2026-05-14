import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React Compiler plugin flags `void asyncFn()` inside useEffect as
      // "calling setState synchronously" — false-positive for the `void promise` pattern.
      "react-hooks/set-state-in-effect": "off",
      // TanStack Virtual: documented incompatible with React Compiler memoization heuristics.
      "react-hooks/incompatible-library": "off",
    },
  },
]);

export default eslintConfig;
