// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.local/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/generated/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      // Config files that live outside any tsconfig project boundary
      "**/vite.config.ts",
      "**/orval.config.ts",
      "**/drizzle.config.ts",
      // Integration lib templates that aren't part of the project tsconfig
      "lib/integrations/**",
    ],
  },

  // ── All TypeScript files ────────────────────────────────────────────────────
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // Unhandled async — the primary reason this rule set exists.
      // Catches fire-and-forget mistakes that silently swallow errors.
      "@typescript-eslint/no-floating-promises": "error",

      // console.* defaults to off; api-server escalates below.
      "no-console": "off",
    },
  },

  // ── API server routes & lib — console must not reach production logs ────────
  // Convention is req.log / logger (pino). Raw console bypasses log-level
  // control and structured JSON output. Scripts are excluded (CLI tools).
  {
    files: [
      "artifacts/api-server/src/routes/**/*.ts",
      "artifacts/api-server/src/lib/**/*.ts",
      "artifacts/api-server/src/app.ts",
      "artifacts/api-server/src/cron.ts",
    ],
    rules: {
      "no-console": "error",
    },
  },
);
