import * as tsParser from "@typescript-eslint/parser"
import type { RuleModuleWithMetaDocs } from "@typescript-eslint/utils/ts-eslint"
import * as astroParser from "astro-eslint-parser"
import type { ESLint, Linter } from "eslint"
import AstroPlugin from "eslint-plugin-astro"
import * as ImportPlugin from "eslint-plugin-import-x"
import { default as SimpleImportSortPlugin } from "eslint-plugin-simple-import-sort"
import StorybookPlugin from "eslint-plugin-storybook"
import LasertagPlugin from "lasertag/eslint-plugin"

import AtomIOPlugin from "./packages/atom.io/src/eslint-plugin/index.ts"
import { LINT_IGNORES } from "./scripts/lint-common.ts"

type Rules = Linter.Config[`rules`]
type StorybookRules = typeof StorybookPlugin.rules

const WARN = 1
const ERROR = 2

const TS_LANG_OPTIONS: Linter.Config[`languageOptions`] = {
	parser: tsParser,
	parserOptions: {
		projectService: true,
		sourceType: `module`,
	} satisfies tsParser.ParserOptions,
}

const ASTRO_LANG_OPTIONS: Linter.Config[`languageOptions`] = {
	parser: astroParser,
	parserOptions: {
		parser: tsParser,
		sourceType: `module`,
		extraFileExtensions: [`.astro`],
	},
}

const COMMON_RULES: Rules = {
	"atom.io/exact-catch-types": ERROR,
	"atom.io/explicit-state-types": [ERROR, { permitAnnotation: true }],
	"atom.io/naming-convention": ERROR,

	"import/newline-after-import": ERROR,
	"import/no-duplicates": ERROR,
	"import/extensions": [
		ERROR,
		`never`,
		{
			checkTypeImports: true,
			fix: true,
			ignorePackages: true,
			pattern: {
				cts: `always`,
				mts: `always`,
				ts: `always`,
				tsx: `always`,
			},
		},
	],

	"simple-import-sort/imports": ERROR,
	"simple-import-sort/exports": ERROR,

	"no-mixed-spaces-and-tabs": 0,
	quotes: [ERROR, `backtick`],
}

const LASERTAG_RULES: Rules = {
	"lasertag/access-css-module-class-only": ERROR,
	"lasertag/ban-div": ERROR,
	"lasertag/export-own-component-only": ERROR,
	"lasertag/header-main-footer-as-group": ERROR,
	"lasertag/import-own-css-module-only": ERROR,
	"lasertag/name-imported-css-module-as-css": ERROR,
	"lasertag/render-tag-with-own-name": ERROR,
}

const IGNORES: Linter.Config = {
	ignores: LINT_IGNORES,
}

const COMMON: Linter.Config = {
	languageOptions: TS_LANG_OPTIONS,
	files: [`**/*.ts{,x}`, `eslint.config.ts`],
	plugins: {
		"atom.io": AtomIOPlugin,
		import: ImportPlugin,
		"simple-import-sort": SimpleImportSortPlugin,
	},
	rules: COMMON_RULES,
}

const NO_CONSOLE: Linter.Config = {
	files: [`packages/atom.io/**/src/**/*.ts{,x}`],
	ignores: [`**/*.test.ts`],
	rules: {
		"no-console": ERROR,
	},
}

const PUBLIC_TESTS: Linter.Config = {
	files: [`packages/atom.io/__tests__/public/**/*.ts{,x}`],
	rules: {
		"import/no-internal-modules": [
			ERROR,
			{
				forbid: [`atom.io/internal`, `atom.io/internal/**`],
			},
		],
	},
}

const STORYBOOK: Linter.Config = {
	files: [`packages/atom.io/**/*.stories.ts{,x}`],
	plugins: { storybook: StorybookPlugin as any as ESLint.Plugin },
	rules: {
		quotes: [ERROR, `double`],
		...({
			"storybook/await-interactions": ERROR,
			"storybook/context-in-play-function": ERROR,
			"storybook/csf-component": 0,
			"storybook/default-exports": ERROR,
			"storybook/hierarchy-separator": WARN,
			"storybook/meta-inline-properties": 0,
			"storybook/meta-satisfies-type": 0,
			"storybook/no-redundant-story-name": WARN,
			"storybook/no-renderer-packages": ERROR,
			"storybook/no-stories-of": 0,
			"storybook/no-title-property-in-meta": 0,
			"storybook/no-uninstalled-addons": 0,
			"storybook/prefer-pascal-case": WARN,
			"storybook/story-exports": ERROR,
			"storybook/use-storybook-expect": ERROR,
			"storybook/use-storybook-testing-library": ERROR,
		} satisfies {
			// https://storybook.js.org/docs/configure/integration/eslint-plugin
			[K in keyof StorybookRules as `storybook/${K}`]: StorybookRules[K] extends RuleModuleWithMetaDocs<
				any,
				infer Options
			>
				? 0 | 1 | 2 | [0 | 1 | 2, Options]
				: 0 | 1 | 2
		}),
	},
}

const LASERTAG_ASTRO: Linter.Config = {
	languageOptions: ASTRO_LANG_OPTIONS,
	files: [`apps/atom.io.fyi/src/**/*.astro`],
	ignores: [`**/exhibits-wrapped/**`],
	plugins: {
		astro: AstroPlugin,
		lasertag: LasertagPlugin,
	},
	rules: LASERTAG_RULES,
	processor: `astro/client-side-ts`,
}

const LASERTAG_TSX: Linter.Config = {
	files: [`apps/atom.io.fyi/src/**/*.tsx`],
	ignores: [`**/exhibits-wrapped/**`],
	plugins: { lasertag: LasertagPlugin },
	rules: LASERTAG_RULES,
}

export default [
	IGNORES,
	COMMON,
	NO_CONSOLE,
	PUBLIC_TESTS,
	STORYBOOK,
	LASERTAG_ASTRO,
	LASERTAG_TSX,
] satisfies Linter.Config[]
