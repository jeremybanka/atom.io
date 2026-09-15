import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import discoverSubmodules from "./__scripts__/discover-submodules.ts"
import { eslintPluginHelpers } from "./__scripts__/eslint-plugin-build.ts"
import { fromEntries } from "./src/foundations/entries/index.ts"

const SUBMODULE_NAMES = discoverSubmodules()

const NEVER_BUNDLE = [
	/^node:/,
	/^eslint-/,
	/^@eslint\//,
	/^@typescript-eslint\/(?!utils(?:\/|$))/,
	`atom.io`,
	...SUBMODULE_NAMES.map((submodule) => `atom.io/${submodule}`),
]

const ALL_ENTRIES = {
	"main/index": `src/main/index.ts`,
	...fromEntries(
		SUBMODULE_NAMES.map(
			(name) => [`${name}/index`, `src/${name}/index.ts`] as const,
		),
	),
}

console.log({ SUBMODULE_NAMES, ALL_ENTRIES })

const sharedConfig = {
	deps: {
		neverBundle: NEVER_BUNDLE,
		alwaysBundle: [`@typescript-eslint/utils/eslint-utils`],
		dts: {
			neverBundle: [...NEVER_BUNDLE, `eslint`, /^@typescript-eslint\//],
		},
	},
	plugins: [eslintPluginHelpers()],
	css: {
		splitting: true,
	},

	dts: { sourcemap: true },
	fixedExtension: false,
	format: `esm`,
	outDir: `dist`,
	platform: `neutral`,
	sourcemap: false,
	treeshake: true,
	tsconfig: `tsconfig.json`,
} satisfies UserConfig

const config: UserConfig = defineConfig({
	...sharedConfig,
	clean: true,
	entry: ALL_ENTRIES,
})

export default config
