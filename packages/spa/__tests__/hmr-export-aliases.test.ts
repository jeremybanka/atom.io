// @vitest-environment node

import { runInNewContext } from "node:vm"

import { transformSync } from "esbuild"
import { expect, it, vi } from "vitest"

import { compile } from "../src/compiler.ts"
import { hotModule } from "../src/compiler-hmr.ts"
import { refresh, registerComponent } from "../src/hot.ts"
import { jsx, merge } from "../src/jsx-runtime.ts"

it.each([
	[
		`export { View }; export default View`,
		`export default View; export { View }`,
	],
	[`export { View as A, View as Z }`, `export { View as Z, View as A }`],
])(
	`updates existing importers when equivalent export aliases reorder: %s`,
	(before, after) => {
		const evaluate = (exports: string, version: string) => {
			const filename = `/src/aliases-${before}.tsx`
			const compiled = compile(
				`function View() { return <p>${version}</p> }; ${exports}`,
				filename,
			)
			const output = hotModule(compiled.code, filename, compiled.map)!
			const { code } = transformSync(output.code, {
				loader: `tsx`,
				format: `cjs`,
				define: { "import.meta.hot": `__hot` },
			})
			const module = {
				exports: {} as Record<string, () => { props: { children: string } }>,
			}
			runInNewContext(code, {
				require: (name: string) => {
					if (name === `@atom.io/spa/jsx-runtime`) return { jsx, merge }
					expect(name).toBe(`@atom.io/spa/hot`)
					return { refresh, registerComponent }
				},
				module,
				exports: module.exports,
				__hot: { accept: vi.fn() },
			})
			return module.exports
		}
		const original = evaluate(before, `before`)
		for (const component of Object.values(original))
			expect(component().props.children).toBe(`before`)
		for (const version of [`after`, `later`]) {
			const updated = evaluate(after, version)
			for (const [name, component] of Object.entries(original)) {
				expect(component().props.children).toBe(version)
				expect(updated[name]).toBe(component)
			}
		}
	},
)
