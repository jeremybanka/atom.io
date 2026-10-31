import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { dev } from "astro"
import { chromium } from "playwright"

import { check } from "../__tests__/browser.check.mjs"

const cacheDir = await mkdtemp(join(tmpdir(), `spa-dev-test-`))
let server, browser
try {
	server = await dev({
		root: fileURLToPath(new URL(`../__tests__/astro/`, import.meta.url)),
		server: { host: `127.0.0.1`, port: 0 },
		vite: { cacheDir },
		logLevel: `error`,
	})
	browser = await chromium.launch()
	const page = await browser.newPage()
	const errors = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`console`, (message) => {
		if (message.type() === `error`) errors.push(message.text())
	})
	const baseURL = `http://127.0.0.1:${server.address.port}`
	await check(page, baseURL)
	assert.equal(await page.locator(`#probe`).getAttribute(`data-mounted`), `true`)
	await page.evaluate(() => {
		window.__spaNavigation = true
	})
	await page.locator(`a[href="/next"]`).click()
	await page.waitForURL(`${baseURL}/next`)
	await page.waitForFunction(
		() =>
			document.querySelectorAll(`astro-island:not([ssr])`).length === 4 &&
			document.querySelector(`#probe`)?.getAttribute(`data-mounted`) === `true`,
	)
	assert.equal(await page.evaluate(() => window.__spaNavigation), true)
	const counter = page.locator(`astro-island`).first().locator(`button`)
	assert.equal(await counter.textContent(), `2`)
	await counter.click()
	await page.waitForFunction(
		() => document.querySelector(`button`)?.textContent === `3`,
	)
	assert.deepEqual(errors, [])
	console.log(
		`Dev browser checks passed: shared runtime, mount hooks, reactive state, and client navigation.`,
	)
} finally {
	await browser?.close()
	await server?.stop()
	await rm(cacheDir, { recursive: true, force: true })
}
