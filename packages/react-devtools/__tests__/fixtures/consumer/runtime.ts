import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

import { StoreProvider } from "@atom.io/react"
import { AtomIODevtools } from "@atom.io/react-devtools"
import { Silo } from "atom.io"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

await test(`devtools render through the consumer's provider and packaged Motion`, () => {
	const silo = new Silo({
		name: `devtools-consumer`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const html = renderToString(
		createElement(StoreProvider, {
			store: silo.store,
			children: createElement(AtomIODevtools),
		}),
	)
	assert.match(html, /data-testid="devtools"/)
})

await test(`the stylesheet is available at the public CSS export`, async () => {
	const css = await readFile(
		new URL(import.meta.resolve(`@atom.io/react-devtools/css`)),
		`utf8`,
	)
	assert(css.length > 0)
})
