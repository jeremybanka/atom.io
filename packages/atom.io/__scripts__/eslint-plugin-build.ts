import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

import type { Rolldown } from "tsdown"

/** Bundle the two runtime helpers without the CommonJS barrel's other exports. */
export function eslintPluginHelpers(): Rolldown.Plugin {
	const require = createRequire(import.meta.url)
	const directory = dirname(
		require.resolve(`@typescript-eslint/utils/eslint-utils`),
	)
	const entry = `\0atom.io/eslint-helpers`
	const pluginSource = resolve(
		import.meta.dirname,
		`../src/eslint-plugin/index.ts`,
	)
	const helpers = new Set(
		[
			`RuleCreator`,
			`getParserServices`,
			`applyDefault`,
			`deepMerge`,
			`parserSeemsToBeTSESLint`,
		].map((name) => join(directory, `${name}.js`)),
	)
	return {
		name: `atom.io-eslint-helpers`,
		resolveId(id) {
			if (id === `@typescript-eslint/utils/eslint-utils`) return entry
		},
		load(id) {
			if (id !== entry) return
			// The authoring dependency is pinned; a changed upstream layout fails the build.
			return [`RuleCreator`, `getParserServices`]
				.map(
					(name) =>
						`export { ${name} } from ${JSON.stringify(join(directory, `${name}.js`))}`,
				)
				.join(`\n`)
		},
		generateBundle(_options, bundle) {
			const entries = Object.values(bundle).filter(
				(chunk) =>
					chunk.type === `chunk` &&
					chunk.isEntry &&
					chunk.facadeModuleId === pluginSource,
			)
			if (entries.length !== 1) {
				this.error(
					`Expected one runtime entry for atom.io/eslint-plugin, found ${entries.length}`,
				)
			}
			const chunks = new Set(entries.map((chunk) => chunk.fileName))
			for (const filename of chunks) {
				const chunk = bundle[filename]
				if (chunk?.type !== `chunk`) {
					this.error(
						`Cannot validate atom.io/eslint-plugin runtime chunk: ${filename}`,
					)
				}
				for (const id of Object.keys(chunk.modules)) {
					if (id.includes(`/node_modules/`) && !helpers.has(id)) {
						this.error(
							`Unexpected dependency bundled into atom.io/eslint-plugin: ${id}`,
						)
					}
				}
				for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
					if (!bundle[dependency]) {
						this.error(
							`atom.io/eslint-plugin has an external runtime import: ${dependency}`,
						)
					}
					chunks.add(dependency)
				}
			}
			this.emitFile({
				type: `asset`,
				fileName: `eslint-plugin/THIRD_PARTY_LICENSES.txt`,
				source: `Bundled @typescript-eslint/utils runtime helpers and rule declarations:\n\n${readFileSync(join(directory, `../../LICENSE`), `utf8`)}`,
			})
		},
	}
}
