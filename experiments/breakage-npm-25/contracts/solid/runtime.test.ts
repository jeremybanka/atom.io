import assert from "node:assert/strict"
import { test } from "node:test"

import { StoreContext, useI, useO } from "@atom.io/solid"
import { Silo } from "atom.io"
import { createRoot } from "solid-js"

test(`bindings share the consumer's store and retain typed write behavior`, () => {
	const silo = new Silo({ name: `solid-consumer`, lifespan: `ephemeral` })
	const countAtom = silo.atom<number>({ key: `count`, default: 7 })
	createRoot((dispose) => {
		try {
			StoreContext.Provider({
				value: silo.store,
				get children() {
					const read = useO(countAtom)
					const write = useI(countAtom)
					assert.equal(read(), 7)
					write(8)
					assert.equal(read(), 8)
					assert.equal(silo.getState(countAtom), 8)
					return undefined
				},
			})
		} finally {
			dispose()
		}
	})
})
