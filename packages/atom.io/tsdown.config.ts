import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import discoverSubmodules from "./__scripts__/discover-submodules.ts"
import { fromEntries } from "./src/foundations/entries/index.ts"

const SUBMODULE_NAMES = discoverSubmodules()

const NEVER_BUNDLE = [
	/^node:/,
	/^eslint-/,
	/^@eslint\//,
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
		dts: {
			alwaysBundle: [`@atom.io/eslint-plugin`],
			neverBundle: [...NEVER_BUNDLE, `eslint`, /^@typescript-eslint\//],
		},
		// Bundle the legacy ESLint export so its peers never affect runtime identity.
		alwaysBundle: [
			/^@atom.io\/eslint-plugin$/,
			/^@typescript-eslint\/(?:utils|types)(?:\/|$)/,
		],
	},
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
