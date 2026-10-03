import assert from "node:assert/strict"
import { resolve } from "node:path"
import { it } from "node:test"

import type { Rolldown, UserConfig } from "tsdown"
import { build } from "tsdown"

import { eslintPluginHelpers } from "./eslint-plugin-build.ts"

const coreRoot = resolve(import.meta.dirname, `..`)
const pluginSource = resolve(coreRoot, `src/eslint-plugin/index.ts`)

function buildPlugin(options: UserConfig = {}): ReturnType<typeof build> {
	return build({
		cwd: coreRoot,
		config: false,
		entry: { renamed: pluginSource },
		outputOptions: { entryFileNames: `renamed-[hash].mjs` },
		write: false,
		clean: false,
		dts: false,
		logLevel: `silent`,
		platform: `neutral`,
		deps: { alwaysBundle: [`@typescript-eslint/utils/eslint-utils`] },
		plugins: [eslintPluginHelpers()],
		...options,
	})
}

function injectImport(id: string, bundled = false): Rolldown.Plugin {
	return {
		name: `test-plugin-dependency`,
		transform(code, moduleId) {
			if (moduleId === pluginSource) {
				return `${code}\nimport { value } from ${JSON.stringify(id)}; console.log(value);`
			}
		},
		resolveId(source) {
			if (source === id) return { id, external: !bundled }
		},
		load(moduleId) {
			if (moduleId === id && bundled) return `export const value = Math.random()`
		},
	}
}

await it(`validates a renamed runtime entry`, async () => {
	await assert.doesNotReject(buildPlugin())
})

await it(`rejects a build missing the runtime entry`, async () => {
	await assert.rejects(
		buildPlugin({ entry: { other: resolve(coreRoot, `src/main/index.ts`) } }),
		/Expected one runtime entry for atom.io\/eslint-plugin/,
	)
})

await it(`rejects external imports even when the entry is renamed`, async () => {
	await assert.rejects(
		buildPlugin({
			plugins: [injectImport(`unexpected-external`), eslintPluginHelpers()],
		}),
		/atom.io\/eslint-plugin has an external runtime import: unexpected-external/,
	)
})

await it(`rejects bundled dependencies outside the helper allowlist`, async () => {
	await assert.rejects(
		buildPlugin({
			plugins: [
				injectImport(`/virtual/node_modules/unexpected/index.js`, true),
				eslintPluginHelpers(),
			],
		}),
		/Unexpected dependency bundled into atom.io\/eslint-plugin/,
	)
})
