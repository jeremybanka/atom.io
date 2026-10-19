import assert from "node:assert/strict"
import { test } from "node:test"

import { StoreProvider, useO } from "@atom.io/react"
import { Silo } from "atom.io"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

test(`bindings read the consumer's store and observe writes`, () => {
	const silo = new Silo({ name: `react-consumer`, lifespan: `ephemeral` })
	const countAtom = silo.atom<number>({ key: `count`, default: 7 })
	function Counter() {
		return createElement(`span`, null, useO(countAtom))
	}
	const render = () =>
		renderToString(
			createElement(StoreProvider, {
				store: silo.store,
				children: createElement(Counter),
			}),
		)
	assert.equal(render(), `<span>7</span>`)
	silo.setState(countAtom, 8)
	assert.equal(render(), `<span>8</span>`)
})
