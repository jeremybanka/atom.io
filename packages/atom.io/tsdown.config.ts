import { comptime } from "comptime/rolldown"
import MagicString from "magic-string"
import type { UserConfig } from "tsdown"
import { defineConfig } from "tsdown"

import discoverSubmodules from "./__scripts__/discover-submodules.ts"
import { fromEntries } from "./src/foundations/entries/index.ts"

const SUBMODULE_NAMES = new Set(discoverSubmodules())
const BUNDLED_SUBMODULES = new Set([`foundations/enumeration`])

const ALWAYS_BUNDLE = [...BUNDLED_SUBMODULES].map(
	(submodule) => `atom.io/${submodule}`,
)
const NEVER_BUNDLE = [
	/^node:/,
	/^eslint-/,
	/^@eslint\//,
	/^@typescript-eslint\//,
	`atom.io`,
	...[...SUBMODULE_NAMES.difference(BUNDLED_SUBMODULES)].map(
		(submodule) => `atom.io/${submodule}`,
	),
]

const bundleSubmoduleImports = () => ({
	name: `bundle-submodule-imports`,
	transform(code: string) {
		const transformed = new MagicString(code)
		for (const submodule of BUNDLED_SUBMODULES) {
			const moduleSpecifier = JSON.stringify(`atom.io/${submodule}`)
			transformed.replaceAll(
				`import { enumeration } from ${moduleSpecifier}`,
				`import { enumeration } from ${JSON.stringify(
					`${import.meta.dirname}/src/${submodule}/index.ts`,
				)}`,
			)
		}
		if (!transformed.hasChanged()) return null
		return {
			code: transformed.toString(),
			map: transformed.generateMap({ hires: true }),
		}
	},
})

const ALL_ENTRIES = {
	"main/index": `src/main/index.ts`,
	...fromEntries(
		[...SUBMODULE_NAMES].map(
			(name) => [`${name}/index`, `src/${name}/index.ts`] as const,
		),
	),
}

console.log({ SUBMODULE_NAMES: [...SUBMODULE_NAMES], ALL_ENTRIES })

const sharedConfig = {
	deps: {
		alwaysBundle: ALWAYS_BUNDLE,
		neverBundle: NEVER_BUNDLE,
		dts: {
			neverBundle: [...NEVER_BUNDLE, ...ALWAYS_BUNDLE],
		},
	},
	css: {
		splitting: true,
	},

	dts: { sourcemap: true },
	fixedExtension: false,
	format: `esm`,
	outDir: `dist`,
	platform: `neutral`,
	plugins: [bundleSubmoduleImports(), comptime()],
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
