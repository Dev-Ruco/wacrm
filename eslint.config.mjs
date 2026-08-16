import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The agent flow chooses among stable Lucide icon components imported at module scope.
  // React's static-components rule treats the dynamic lookup as component creation during render,
  // but no component is actually created there and no state is reset.
  {
    files: ["src/components/agents/agent-flow-panel.tsx"],
    rules: {
      "react-hooks/static-components": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
  ]),
]);

export default eslintConfig;
