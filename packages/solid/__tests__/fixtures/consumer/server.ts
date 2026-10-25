import assert from "node:assert/strict"
import { test } from "node:test"

import { StoreProvider, useO } from "@atom.io/solid"
import { Silo } from "atom.io"
import { createRoot, untrack } from "solid-js"

await test(`server reads use the provider store without retaining subscriptions`, () => {
	const silo = new Silo({
		name: `solid-server`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const valueAtom = silo.atom<number>({ key: `value`, default: 42 })
	let rendered = false
	createRoot((dispose) => {
		try {
			let result: unknown = StoreProvider({
				store: silo.store,
				get children() {
					untrack(() => {
						rendered = true
						assert.equal(useO(valueAtom)(), 42)
						return undefined
					})
					return undefined
				},
			})
			while (typeof result === `function`) result = result()
			assert.equal(rendered, true)
			assert.equal(
				silo.store.atoms.get(valueAtom.key)!.subject.subscribers.size,
				0,
			)
		} finally {
			dispose()
		}
	})
})
