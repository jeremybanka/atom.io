import { expect, it, vi } from "vitest"

import { merge } from "../src/jsx-runtime.ts"
import { instanceProps } from "../src/props.ts"

it(`only reports properties owned by a current source without evaluating getters`, () => {
	const read = vi.fn(() => `value`)
	const source = Object.create({ inherited: true })
	Object.defineProperty(source, `present`, { enumerable: true, get: read })
	const props = merge(source)
	expect(Object.keys(props)).toEqual([`present`])
	expect(Object.hasOwn(props, `present`)).toBe(true)
	expect(`present` in props).toBe(true)
	for (const key of [`missing`, `inherited`, `toString`]) {
		expect(Object.hasOwn(props, key)).toBe(false)
		expect(key in props).toBe(false)
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
	expect(`title` in forwarded).toBe(false)
	expect(`title` in props).toBe(true)
	expect(props[`viewBox`]).toBe(`0 0 500 101`)
	expect(props[`title`]).toBe(`default`)
	source = { title: `override`, unrelated: true }
	expect(`title` in forwarded).toBe(true)
	expect({ ...props }).toEqual({
		viewBox: `0 0 500 101`,
		title: `override`,
		unrelated: true,
	})
	source[`viewBox`] = undefined
	expect(`viewBox` in forwarded).toBe(true)
	expect(Object.hasOwn(forwarded, `viewBox`)).toBe(true)
	expect(props[`viewBox`]).toBeUndefined()
	delete source[`viewBox`]
	delete source[`title`]
	expect(`viewBox` in forwarded).toBe(false)
	expect(`title` in forwarded).toBe(false)
	expect(`title` in props).toBe(true)
	expect(Object.hasOwn(forwarded, `viewBox`)).toBe(false)
	expect({ ...props }).toEqual({
		viewBox: `0 0 500 101`,
		title: `default`,
		unrelated: true,
	})
})

it.each([
	{ present: false, initial: {}, key: undefined },
	{ present: true, initial: { key: undefined }, key: undefined },
	{ present: true, initial: { key: null }, key: null },
	{ present: true, initial: { key: `row` }, key: `row` },
])(
	`pins key membership for initial props $initial`,
	({ present, initial, key }) => {
		let source: Record<string, unknown> = { ...initial, label: undefined }
		const props = instanceProps(() => source, key)
		expect(`label` in props).toBe(true)
		expect(`missing` in props).toBe(false)
		expect(`key` in props).toBe(present)
		expect(Object.hasOwn(props, `key`)).toBe(present)
		source = present ? {} : { key: `added` }
		expect(`label` in props).toBe(false)
		expect(`key` in props).toBe(present)
		expect(Object.hasOwn(props, `key`)).toBe(present)
		expect(props[`key`]).toBe(key)
	},
)
