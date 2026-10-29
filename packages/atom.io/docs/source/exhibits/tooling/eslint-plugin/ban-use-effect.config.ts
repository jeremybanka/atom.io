import atomIO from "@atom.io/eslint-plugin"
import parser from "@typescript-eslint/parser"
import type { Linter } from "eslint"

const config: Linter.Config[] = [
	{
		files: [`src/**/*.{js,jsx,ts,tsx}`],
		languageOptions: {
			parser,
			parserOptions: { ecmaFeatures: { jsx: true } },
		},
		plugins: { "atom.io": atomIO },
		rules: { "atom.io/ban-use-effect": `error` },
	},
]

export default config
