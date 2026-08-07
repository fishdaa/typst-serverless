import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
    ...tseslint.configs.strict,
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
            "indent": ["error", 4],
        },
    },
    {
        ignores: ["dist/**", "dist-lambda/**", "node_modules/**", "**/pulumi/**", ".devbox/**"],
    },
);
