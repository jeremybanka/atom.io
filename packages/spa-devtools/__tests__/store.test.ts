import { render } from "@atom.io/spa"
import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import { useExpanded, useSaved, useTools } from "../src/store.ts"

afterEach(() => {
	vi.restoreAllMocks()
	localStorage.clear()
})
const store = () =>
	new Silo({ name: `storage`, lifespan: `ephemeral`, isProduction: true }).store
it(`validates persisted state and survives unavailable storage`, () => {
	for (const saved of [`broken`, `null`, `1`, `"saved"`]) {
		localStorage.setItem(`saved`, saved)
		const instance = store()
		const root = render(
			() => {
				const [read, set] = useSaved(instance, `saved`, `fallback`)
				expect(read()).toBe(saved === `"saved"` ? `saved` : `fallback`)
				set(`next`)
				expect(read()).toBe(`next`)
				return null
			},
			document.createElement(`div`),
			{ store: instance },
		)
		root.dispose()
	}
	const instance = store()
	vi.spyOn(Storage.prototype, `getItem`).mockImplementation(() => {
		throw new Error(`denied`)
	})
	vi.spyOn(Storage.prototype, `setItem`).mockImplementation(() => {
		throw new Error(`denied`)
	})
	const root = render(
		() => {
			const [read, set] = useSaved(instance, `saved`, false)
			set(true)
			expect(read()).toBe(true)
			const tools = useTools(instance)
			const [expanded, toggle] = useExpanded(tools, [`x`])
			toggle(new MouseEvent(`click`))
			expect(expanded()).toBe(true)
			tools.attempt(() => {
				// oxlint-disable-next-line typescript/only-throw-error -- Exercise non-Error user failures.
				throw `plain error`
			})
			expect(instance.atoms.get(tools.error.key)).toBeDefined()
			return null
		},
		document.createElement(`div`),
		{ store: instance },
	)
	root.dispose()
})
it(`validates expansion records and applies sibling overrides without disturbing other parents`, () => {
	for (const saved of [
		`null`,
		`1`,
		`[]`,
		`{"x":1}`,
		`invalid`,
		`{"[\"a\",\"x\"]":true}`,
	]) {
		localStorage.setItem(`🔍 spa expanded`, saved)
		const instance = store()
		const root = render(
			() => {
				useTools(instance)
				return null
			},
			document.createElement(`div`),
			{ store: instance },
		)
		root.dispose()
	}
	const instance = store()
	localStorage.setItem(
		`🔍 spa expanded`,
		JSON.stringify({ '["a","x"]': true, '["b","x"]': true, 'all:["a"]': true }),
	)
	const root = render(
		() => {
			const tools = useTools(instance)
			const [a, toggle] = useExpanded(tools, [`a`, `x`])
			const [b] = useExpanded(tools, [`b`, `x`])
			expect(a()).toBe(true)
			toggle(new MouseEvent(`click`, { shiftKey: true }))
			expect(a()).toBe(false)
			expect(b()).toBe(true)
			return null
		},
		document.createElement(`div`),
		{ store: instance },
	)
	root.dispose()
})
