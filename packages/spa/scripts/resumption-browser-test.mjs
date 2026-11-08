import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve } from "node:path"

import { dev } from "astro"
import { chromium } from "playwright"

const fixture = resolve(import.meta.dirname, `../__tests__/resumption`)
const directory = resolve(fixture, `dist`)
const development = process.argv.includes(`--dev`)
let stop
let port
if (development) {
	const server = await dev({
		root: fixture,
		server: { host: `127.0.0.1`, port: 0 },
		logLevel: `error`,
	})
	port = server.address.port
	stop = () => server.stop()
} else {
	const server = createServer(async (request, response) => {
		const pathname = decodeURIComponent(
			new URL(request.url, `http://localhost`).pathname,
		)
		const file = resolve(
			directory,
			`.${extname(pathname) ? pathname : `${pathname.replace(/\/$/, ``)}/index.html`}`,
		)
		if (!file.startsWith(`${directory}/`)) {
			response.writeHead(403).end()
			return
		}
		try {
			response.setHeader(
				`content-type`,
				extname(file) === `.js` ? `application/javascript` : `text/html`,
			)
			response.end(await readFile(file))
		} catch {
			response.writeHead(404).end()
		}
	})
	await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
	port = server.address().port
	stop = () => new Promise((done) => server.close(done))
}
let browser
try {
	const origin = `http://127.0.0.1:${port}`
	const response = await fetch(origin)
	const html = await response.text()
	assert.equal(response.status, 200)
	assert.ok(html.includes(`data-resumability-page`))
	browser = await chromium.launch()
	const page = await browser.newPage()
	const errors = []
	const warnings = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`console`, (message) => {
		if (
			message.type() === `warning` &&
			message.text().startsWith(`spa: hydration mismatch`)
		)
			warnings.push(message.text())
	})
	let gate = Promise.withResolvers()
	await page.route(`**/*`, async (route) => {
		if (route.request().resourceType() === `script`) await gate.promise
		await route.continue()
	})
	await page.goto(origin, { waitUntil: `commit` })
	await page.waitForSelector(`output`)
	await page.evaluate(() => {
		window.__originalOutput = document.querySelector(`output`)
	})
	gate.resolve()
	await page.waitForSelector(`astro-island:not([ssr])`)
	await page.waitForSelector(`html[data-resumed-title]`)
	assert.equal(await page.locator(`output`).textContent(), `Database constant`)
	assert.equal(
		await page.locator(`html`).getAttribute(`data-resumed-title`),
		`Database constant`,
	)
	assert.equal(
		await page.evaluate(
			() => document.querySelector(`output`) === window.__originalOutput,
		),
		true,
	)
	gate = Promise.withResolvers()
	const asyncResponse = await page.goto(`${origin}/async/`, {
		waitUntil: `commit`,
	})
	assert.equal(asyncResponse.status(), 200)
	await page.waitForSelector(`[data-ordinary]`)
	await page.evaluate(() => {
		window.__ordinaryOutput = document.querySelector(`[data-ordinary]`)
	})
	const asyncHtml = await asyncResponse.text()
	assert.equal((asyncHtml.match(/Async value/g) ?? []).length, 2)
	assert.ok(asyncHtml.includes(`data-spa-reads`))
	gate.resolve()
	await page.waitForFunction(
		() =>
			!document.querySelector(`astro-island[ssr]`) &&
			document.querySelector(`[data-ordinary]`)?.textContent === `Async value` &&
			document.querySelector(`[data-mixed]`)?.textContent === `Async value`,
	)
	assert.equal(
		await page.locator(`[data-seeded]`).textContent(),
		`Database constant`,
	)
	assert.equal(
		await page.evaluate(
			() =>
				document.querySelector(`[data-ordinary]`) === window.__ordinaryOutput,
		),
		false,
	)
	assert.deepEqual(warnings, [])
	gate = Promise.withResolvers()
	await page.goto(`${origin}/recovery/`, { waitUntil: `commit` })
	await page.waitForSelector(`[data-recovery="healthy"] button`)
	await page.evaluate(() => {
		const broken = document.querySelector(`[data-recovery="broken"]`)
		window.__keptInput = broken.querySelector(`input`)
		window.__keptInput.value = `unsaved`
		window.__keptInput.focus()
		broken.querySelector(`button`).replaceWith(document.createElement(`span`))
		window.__healthyButton = document.querySelector(
			`[data-recovery="healthy"] button`,
		)
	})
	gate.resolve()
	await page.waitForFunction(
		() =>
			!document.querySelector(`astro-island[ssr]`) &&
			document.documentElement.getAttribute(`data-broken-mounts`) === `1` &&
			document.documentElement.getAttribute(`data-healthy-mounts`) === `1`,
	)
	assert.equal(
		await page.locator(`html`).getAttribute(`data-broken-setups`),
		`1`,
	)
	assert.equal(
		await page.locator(`html`).getAttribute(`data-broken-cleanups`),
		null,
	)
	assert.equal(
		await page.evaluate(
			() =>
				document.querySelector(`[data-recovery="broken"] input`) ===
					window.__keptInput &&
				document.activeElement === window.__keptInput &&
				window.__keptInput.value === `unsaved`,
		),
		true,
	)
	assert.equal(
		await page.evaluate(
			() =>
				document.querySelector(`[data-recovery="healthy"] button`) ===
				window.__healthyButton,
		),
		true,
	)
	assert.equal(warnings.length, 1)
	assert.match(warnings[0], /Repairing.*unsaved input/)
	await page.locator(`[data-recovery="broken"] button`).click()
	assert.equal(
		await page.locator(`[data-recovery="broken"] button`).textContent(),
		`1`,
	)
	assert.equal(
		await page.locator(`[data-recovery="healthy"] button`).textContent(),
		`0`,
	)
	await page.locator(`[data-recovery="healthy"] button`).click()
	assert.equal(
		await page.locator(`[data-recovery="healthy"] button`).textContent(),
		`1`,
	)
	await page.evaluate(() =>
		document
			.querySelector(`[data-recovery="broken"]`)
			.closest(`astro-island`)
			.dispatchEvent(new Event(`astro:unmount`)),
	)
	assert.equal(
		await page.locator(`html`).getAttribute(`data-broken-cleanups`),
		`1`,
	)
	await page.locator(`[data-recovery="healthy"] button`).click()
	assert.equal(
		await page.locator(`[data-recovery="healthy"] button`).textContent(),
		`2`,
	)
	assert.deepEqual(errors, [])
	console.log(
		`${development ? `Development` : `Production`}: constant props, async readiness, and hydration recovery preserve live islands, input, focus, ownership, and neighboring roots.`,
	)
} finally {
	await browser?.close()
	await stop()
}
