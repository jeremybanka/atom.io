import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve } from "node:path"

import { dev } from "astro"
import { chromium } from "playwright"

const directory = resolve(import.meta.dirname, `../dist`)
const development = process.argv.includes(`--dev`)
let stop
let port
if (development) {
	const server = await dev({
		root: resolve(import.meta.dirname, `..`),
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
				{
					".js": `application/javascript`,
					".css": `text/css`,
					".html": `text/html`,
				}[extname(file)] ?? `application/octet-stream`,
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
	assert.equal(response.status, 200)
	const html = await response.text()
	assert.ok(html.includes(`A note from SQLite for document 1.`))
	assert.equal((html.match(/data-resumable/g) ?? []).length, 2)
	assert.equal((html.match(/aria-busy="true"/g) ?? []).length, 0)
	browser = await chromium.launch()
	const page = await browser.newPage()
	const errors = []
	const scripts = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`response`, (result) => {
		if (result.request().resourceType() === `script`)
			scripts.push(result.text().then((code) => ({ code, url: result.url() })))
	})
	// Hold JavaScript until we can inspect and retain the actual server DOM.
	const gate = Promise.withResolvers()
	await page.route(`**/*`, async (route) => {
		if (route.request().resourceType() === `script`) await gate.promise
		await route.continue()
	})
	await page.goto(origin, { waitUntil: `commit` })
	await page.waitForSelector(`textarea`)
	assert.equal(await page.locator(`textarea`).count(), 4)
	const seeds = await page.locator(`[data-revision]`).allTextContents()
	assert.equal(new Set(seeds).size, 4)
	assert.deepEqual(
		await page.locator(`[data-source]`).allTextContents(),
		Array(4).fill(`server`),
	)
	await page.evaluate(() => {
		window.__draftNodes = [...document.querySelectorAll(`textarea`)]
		window.__draftHost = document.querySelector(`resumable-drafts`)
	})
	gate.resolve()
	await page.waitForFunction(
		() => document.querySelectorAll(`resumable-drafts[data-ready]`).length === 2,
	)
	assert.equal(
		await page.evaluate(() =>
			[...document.querySelectorAll(`textarea`)].every(
				(element, index) => element === window.__draftNodes[index],
			),
		),
		true,
	)
	assert.deepEqual(
		await page.locator(`[data-revision]`).allTextContents(),
		seeds,
	)
	assert.equal(
		await page
			.locator(`textarea`)
			.evaluateAll(
				(elements) => new Set(elements.map((element) => element.id)).size,
			),
		4,
	)
	const cards = page.locator(`.draft`)
	await cards.nth(0).locator(`textarea`).fill(`A browser edit`)
	await page.waitForFunction(
		() =>
			document.querySelector(`[data-preview]`).textContent === `A browser edit`,
	)
	assert.equal(
		await cards.nth(2).locator(`textarea`).inputValue(),
		`A note from SQLite for document 1.`,
	)
	await cards.nth(0).locator(`button`).click()
	await page.waitForFunction(
		() => document.querySelector(`[data-revision]`).textContent === `client:1:1`,
	)
	assert.equal(
		await cards.nth(0).locator(`textarea`).inputValue(),
		`Fresh browser draft 1, reset 1.`,
	)
	await cards.nth(0).locator(`button`).click()
	await page.waitForFunction(
		() => document.querySelector(`[data-revision]`).textContent === `client:1:2`,
	)
	assert.deepEqual(
		(await page.locator(`[data-revision]`).allTextContents()).slice(1),
		seeds.slice(1),
	)
	await cards.nth(2).locator(`button`).click()
	await page.waitForFunction(
		() =>
			document.querySelectorAll(`[data-revision]`)[2].textContent ===
			`client:1:1`,
	)
	if (process.env.TEMPLATE_SCREENSHOT)
		await page.screenshot({
			path: process.env.TEMPLATE_SCREENSHOT,
			fullPage: true,
		})
	await page.getByRole(`link`, { name: `How it works` }).click()
	await page.waitForURL(`**/about`)
	await page.waitForFunction(
		() =>
			window.__draftHost.querySelector(`[data-root]`).childNodes.length === 0,
	)
	await page.getByRole(`link`, { name: `Back to drafts` }).click()
	await page.waitForFunction(
		() => document.querySelectorAll(`resumable-drafts[data-ready]`).length === 2,
	)
	assert.deepEqual(
		await page.locator(`[data-source]`).allTextContents(),
		Array(4).fill(`server`),
	)
	await page.locator(`.draft`).first().locator(`button`).click()
	await page.waitForFunction(
		() => document.querySelector(`[data-revision]`).textContent === `client:1:1`,
	)
	assert.deepEqual(errors, [])
	const executable = await Promise.all(scripts)
	assert.ok(executable.length > 0)
	for (const { code, url } of executable) {
		assert.doesNotMatch(url, /database\.server/)
		assert.doesNotMatch(
			code,
			/node:sqlite|database\.server|SELECT \? AS title|A note from SQLite/,
		)
	}
	console.log(
		`${development ? `Development` : `Production`}: server data, DOM-preserving SPA hydration, edits, fresh resets, family/island isolation, navigation cleanup, and server-code removal passed.`,
	)
} finally {
	await browser?.close()
	await stop()
}
