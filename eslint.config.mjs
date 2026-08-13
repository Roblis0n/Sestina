import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Allow explicit any when necessary (e.g., IPC deserialization boundaries)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow non-null assertions in tests
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Allow template expressions for error codes
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // Console is fine for CLI apps
      "no-console": "off",
    },
  },
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "coverage/",
      ".turbo/",
      "**/dist/",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "OpenMythos-main (1)/",
      "artifacts/",
      "release/",
    ],
  },
);
