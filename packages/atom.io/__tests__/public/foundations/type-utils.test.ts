import type { DeepReadonly, Flat, ViewOf } from "atom.io/foundations/type-utils"

describe(`type-utils`, () => {
	test(`DeepReadonly recursively protects objects and collections`, () => {
		type Document = DeepReadonly<{
			metadata: { author: string }
			pages: string[]
			preferences: Map<string, { enabled: boolean }>
			tags: Set<{ name: string }>
		}>
		const assertReadonly = (document: Document): void => {
			// @ts-expect-error Nested properties are readonly.
			document.metadata.author = `Jane Doe`
			// @ts-expect-error Nested arrays are readonly.
			document.pages.push(`cover`)
			// @ts-expect-error Maps become readonly maps.
			document.preferences.set(`spellcheck`, { enabled: true })
			for (const tag of document.tags) {
				// @ts-expect-error Values within sets are deeply readonly.
				tag.name = `draft`
			}
		}

		expect(assertReadonly).toBeTypeOf(`function`)
	})

	test(`Flat preserves the visible shape of an intersection type`, () => {
		const value: Flat<{ a: 1 } & { b: 2 }> = { a: 1, b: 2 }

		expect(value).toEqual({ a: 1, b: 2 })
	})

	test(`ViewOf represents readonly views for common mutable containers`, () => {
		const array: ViewOf<[1, 2]> = [1, 2] as const
		const set: ViewOf<Set<{ value: 1 }>> = new Set([{ value: 1 }])
		const map: ViewOf<Map<{ key: 1 }, { value: 2 }>> = new Map([
			[{ key: 1 }, { value: 2 }],
		])

		expect(array).toEqual([1, 2])
		expect(set.size).toBe(1)
		expect(map.size).toBe(1)
	})
})
