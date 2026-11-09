import { expect, it, vi } from "vitest"

import { merge } from "../src/jsx-runtime.ts"

it(`only reports properties owned by a current source without evaluating getters`, () => {
	const read = vi.fn(() => `value`)
	const source = Object.create({ inherited: true })
	Object.defineProperty(source, `present`, { enumerable: true, get: read })
	const props = merge(source)
	expect(Object.keys(props)).toEqual([`present`])
	expect(Object.hasOwn(props, `present`)).toBe(true)
	for (const key of [`missing`, `inherited`, `toString`]) {
		expect(Object.hasOwn(props, key)).toBe(false)
		expect(Object.getOwnPropertyDescriptor(props, key)).toBeUndefined()
	}
	expect(read).not.toHaveBeenCalled()
	expect(props[`present`]).toBe(`value`)
	expect(read).toHaveBeenCalledOnce()
})

it(`preserves defaults through nested spreads while allowing explicit undefined`, () => {
	let source: Record<string, unknown> = {}
	const forwarded = merge(merge(() => source))
	const props = merge({ viewBox: `0 0 500 101`, title: `default` }, forwarded)
	expect(Object.keys(forwarded)).toEqual([])
	expect(props[`viewBox`]).toBe(`0 0 500 101`)
	expect(props[`title`]).toBe(`default`)
	source = { title: `override`, unrelated: true }
	expect({ ...props }).toEqual({
		viewBox: `0 0 500 101`,
		title: `override`,
		unrelated: true,
	})
	source[`viewBox`] = undefined
	expect(Object.hasOwn(forwarded, `viewBox`)).toBe(true)
	expect(props[`viewBox`]).toBeUndefined()
	delete source[`viewBox`]
	delete source[`title`]
	expect(Object.hasOwn(forwarded, `viewBox`)).toBe(false)
	expect({ ...props }).toEqual({
		viewBox: `0 0 500 101`,
		title: `default`,
		unrelated: true,
	})
})
