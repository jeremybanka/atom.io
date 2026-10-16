import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import type { Rolldown } from "tsdown"

/** Inline rule declarations while retaining the consumer's parser type identities. */
export function eslintPluginTypes(): Rolldown.Plugin {
	const require = createRequire(import.meta.url)
	const directory = dirname(require.resolve(`@typescript-eslint/utils`))
	const declarations = new Map([
		[join(directory, `ts-eslint/Scope.d.ts`), `scope.d.ts`],
		[join(directory, `ts-eslint/ParserOptions.d.ts`), `parser-options.d.ts`],
		[join(directory, `ts-estree.d.ts`), `ast.d.ts`],
	])
	return {
		name: `atom.io-eslint-rule-types`,
		load(id) {
			const declaration = declarations.get(id)
			if (declaration) {
				const file = join(
					import.meta.dirname,
					`eslint-plugin-types`,
					declaration,
				)
				this.addWatchFile(file)
				return readFileSync(file, `utf8`)
			}
		},
	}
}
