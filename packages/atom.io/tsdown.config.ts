import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import discoverSubmodules from "./__scripts__/discover-submodules.ts"
import { fromEntries } from "./src/foundations/entries/index.ts"

const SUBMODULE_NAMES = discoverSubmodules()

const NEVER_BUNDLE = [
	/^node:/,
	/^eslint-/,
	/^@eslint\//,
	/^@typescript-eslint\//,
	`atom.io`,
	...SUBMODULE_NAMES.map((submodule) => `atom.io/${submodule}`),
]

const ALL_ENTRIES = {
	"main/index": `src/main/index.ts`,
	...fromEntries(
		SUBMODULE_NAMES.filter((name) => name !== `realtime-testing/headless`).map(
			(name) => [`${name}/index`, `src/${name}/index.ts`] as const,
		),
	),
}

console.log({ SUBMODULE_NAMES, ALL_ENTRIES })

const sharedConfig = {
	deps: {
		neverBundle: NEVER_BUNDLE,
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

const config: UserConfig[] = defineConfig([
	{
		...sharedConfig,
		clean: true,
		entry: ALL_ENTRIES,
	},
	{
		...sharedConfig,
		clean: false,
		entry: {
			"realtime-testing/headless/index": `src/realtime-testing/headless/index.ts`,
		},
	},
])

export default config
