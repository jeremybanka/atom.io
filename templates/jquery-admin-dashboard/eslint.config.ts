import * as tsParser from "@typescript-eslint/parser"
import AtomIOPlugin from "atom.io/eslint-plugin"
import type { Linter } from "eslint"

export default [
	{ ignores: [`**/dist/**`, `**/node_modules/**`] },
	{
		files: [`**/*.ts`],
		languageOptions: {
			parser: tsParser,
			parserOptions: { projectService: true, sourceType: `module` },
		},
		plugins: { "atom.io": AtomIOPlugin },
		rules: {
			"atom.io/exact-catch-types": `error`,
			"atom.io/explicit-state-types": `error`,
			"atom.io/explicit-transaction-types": `error`,
			"atom.io/naming-convention": `error`,
			quotes: [`error`, `backtick`],
		},
	},
] satisfies Linter.Config[]
