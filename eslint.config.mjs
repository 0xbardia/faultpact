import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/.next/**", "prisma/migrations/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs"],
    languageOptions: { parser: tsParser },
    rules: {
      "no-console": "off",
      "no-unused-vars": "off",
    },
  },
];
