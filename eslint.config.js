// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        window: true,
        document: true,
      },
    },
    plugins: {
      import: require("eslint-plugin-import"),
    },
    rules: {
      // tes règles custom
    },
  },
];
