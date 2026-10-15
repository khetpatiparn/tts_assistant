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
    ".next-dev/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Flow bot runtime — real Chrome profile (ships its own minified extension bundles) and
    // scratch output, none of it source we own. Not linting these matters: without this,
    // `npm run lint` picks up hundreds of pre-minified findings from .flow-profile's bundled
    // extensions that have nothing to do with any task's own diff.
    ".flow-profile/**",
    "worker/smoke/out/**",
    ".check-flow-tmp-*/**",
    ".check-candidates-tmp-*/**",
    ".scratch/**",
    "showcase-extension/**",
  ]),
]);

export default eslintConfig;
