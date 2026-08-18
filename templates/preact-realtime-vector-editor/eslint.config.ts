import * as tsParser from "@typescript-eslint/parser"
import AtomIOPlugin from "atom.io/eslint-plugin"
import type { Linter } from "eslint"
import LasertagPlugin from "lasertag/eslint-plugin"

const ERROR = 2

export default [
	{ ignores: [`**/dist/**`, `**/node_modules/**`] },
	{
		files: [`**/*.ts`, `**/*.tsx`],
		languageOptions: {
			parser: tsParser,
			parserOptions: { projectService: true, sourceType: `module` },
		},
		plugins: { "atom.io": AtomIOPlugin },
		rules: {
			"atom.io/exact-catch-types": ERROR,
			"atom.io/explicit-state-types": [ERROR, { permitAnnotation: true }],
			"atom.io/naming-convention": ERROR,
			quotes: [ERROR, `backtick`],
		},
	},
	{
		files: [`src/**/*.tsx`],
		plugins: { lasertag: LasertagPlugin },
		rules: {
			"lasertag/access-css-module-class-only": ERROR,
			"lasertag/ban-div": ERROR,
			"lasertag/export-own-component-only": ERROR,
			"lasertag/header-main-footer-as-group": ERROR,
			"lasertag/import-own-css-module-only": ERROR,
			"lasertag/name-imported-css-module-as-css": ERROR,
			"lasertag/render-tag-with-own-name": ERROR,
		},
	},
] satisfies Linter.Config[]
