import atomIO from "@atom.io/eslint-plugin"
import parser from "@typescript-eslint/parser"
import type { Linter } from "eslint"

const config: Linter.Config[] = [
	{
		files: [`src/features/**/*.{ts,tsx}`, `src/components/**/*.{ts,tsx}`],
		ignores: [`src/features/legacy/**`, `**/*.test.{ts,tsx}`],
		languageOptions: {
			parser,
			parserOptions: { ecmaFeatures: { jsx: true } },
		},
		plugins: { "atom.io": atomIO },
		rules: { "atom.io/ban-use-effect": `error` },
	},
]

export default config
