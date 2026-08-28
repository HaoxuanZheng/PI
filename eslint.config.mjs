import eslint from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
const config = [
  { ignores: ["**/.next/**", "**/coverage/**", "**/dist/**", "**/node_modules/**"] },
  eslint.configs.recommended,
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "react-hooks/error-boundaries": "off",
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-html-link-for-pages": "off"
    }
  }
];
export default config;
