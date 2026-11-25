import assert from "node:assert/strict"

import { serveDevtoolsStore } from "@atom.io/devtools/standalone"
import { Silo } from "atom.io"

import { launchBrowser } from "./browser-runtime.ts"

const production = new Silo({
	name: `Production test`,
	lifespan: `ephemeral`,
	isProduction: true,
})
await assert.rejects(
	serveDevtoolsStore(production),
	/requires explicit inspection access/,
)

const silo = new Silo({
	name: `Standalone test`,
	lifespan: `ephemeral`,
	isProduction: false,
})
const countAtom = silo.atom<number>({ key: `count`, default: 1 })
assert.equal(silo.getState(countAtom), 1)
const viewer = await serveDevtoolsStore(silo)

try {
	assert.equal(viewer.url.hostname, `127.0.0.1`)
	assert.equal((await fetch(new URL(`/events`, viewer.url))).status, 404)
	assert.equal(
		(await fetch(new URL(`events`, viewer.url), { method: `POST` })).status,
		404,
	)

	const browser = await launchBrowser()
	try {
		const page = await browser.newPage()
		await page.goto(viewer.url.href)
		const panel = page.locator(`debugger-panel:not([hidden])`)
		await panel.getByRole(`tab`, { name: `atoms` }).click()
		await panel.getByText(`Inspection only`).waitFor()
		const value = panel.getByRole(`textbox`, {
			name: countAtom.key,
			exact: true,
		})
		await value.waitFor()
		assert.equal(await value.inputValue(), `1`)
		assert.equal(await value.getAttribute(`readonly`), ``)
		silo.setState(countAtom, 2)
		await page.waitForFunction(
			(key) =>
				document.querySelector<HTMLInputElement>(
					`input[aria-label="` + key + `"]`,
				)?.value === `2`,
			countAtom.key,
		)
	} finally {
		await browser.close()
	}
} finally {
	await viewer.close()
}
