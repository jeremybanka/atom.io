// @vitest-environment node

import { runInNewContext } from "node:vm"

import { transformSync } from "esbuild"
import { expect, it, vi } from "vitest"

import { compile } from "../src/compiler.ts"
import { hotModule } from "../src/compiler-hmr.ts"
import { refresh, registerComponent } from "../src/hot.ts"
import { jsx, merge } from "../src/jsx-runtime.ts"

it(`preserves mount options through a compiled hot proxy and subsequent updates`, () => {
	const evaluate = (version: string) => {
		const filename = `/src/hot-mount-options.tsx`
		const compiled = compile(
			`export function mount(host, options = {}) {
				return { host, store: options.store, hidden: options.hidden,
					view: () => <p>${version}</p> }
			}`,
			filename,
		)
		const hot = hotModule(compiled.code, filename, compiled.map)!
		const { code } = transformSync(hot.code, {
			loader: `tsx`,
			format: `cjs`,
			define: { "import.meta.hot": `__hot` },
		})
		const module = {
			exports: {} as {
				mount(
					host: object,
					options?: { store: object; hidden: boolean },
				): {
					host: object
					store?: object
					hidden?: boolean
					view(): { props: { children: string } }
				}
			},
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
		return module.exports.mount
	}
	const mount = evaluate(`before`)
	const host = {},
		store = {}
	for (const version of [`before`, `after`, `later`]) {
		if (version !== `before`) expect(evaluate(version)).toBe(mount)
		const result = mount(host, { store, hidden: true })
		expect(result.host).toBe(host)
		expect(result.store).toBe(store)
		expect(result.hidden).toBe(true)
		expect(result.view().props.children).toBe(version)
		expect(mount(host).store).toBeUndefined()
	}
})
