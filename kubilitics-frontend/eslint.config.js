import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Backend URL discipline (Option B — no Vite proxy).
      // Every backend call MUST go through apiUrl() / wsUrl() / eventSourceUrl()
      // from `@/lib/backendUrl`. Hardcoded relative `/api/...`, `/ws/...`, or
      // `/healthz` literals worked under the old Vite-proxy setup but break in
      // Tauri (no proxy) and in any deployment where the backend lives on a
      // different origin. The lib/backendUrl.ts file itself is exempt because
      // its docstring contains example strings.
      // Hardcoded backend paths (/api/, /ws/, /healthz) are scanned by
      // scripts/check-backend-paths.mjs (wired into `npm run lint`). We
      // tried doing it in ESLint via no-restricted-syntax, but esquery
      // can't represent a literal `/` in its selector regex cleanly and
      // doesn't honour `^=` on Literal.value reliably across versions.
      // The standalone script is faster, deterministic, and easy to audit.
    },
  },
  // Topology engine: PRD allows `any` in Cytoscape style callbacks; barrel files export components + constants
  {
    files: ["src/topology-engine/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-prototype-builtins": "off",
      "react-refresh/only-export-components": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
);
