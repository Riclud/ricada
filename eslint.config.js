import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["node_modules/", "generated/", "dist/", "coverage/", ".git/", "bun.lock", "*.snap"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-else-return": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
    },
  },
)
