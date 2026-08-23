import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  // NOTE: this REPLACES the defaults rather than adding to them, so any build
  // output directory must be listed here explicitly or ESLint will lint the
  // generated bundles.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Dev server output — see `distDir` in next.config.ts.
    ".next-dev/**",
  ]),
]);

export default eslintConfig;
