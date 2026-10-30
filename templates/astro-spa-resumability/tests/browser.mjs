import assert from "node:assert/strict"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { dev, preview } from "astro"
import { chromium } from "playwright"

const root = resolve(import.meta.dirname, `..`)
process.chdir(root)
const development = process.argv.includes(`--dev`)
const server = await (development ? dev : preview)({
	root,
	server: { host: `127.0.0.1`, port: 0 },
	logLevel: `error`,
})
const port = development ? server.address.port : server.server.address().port
const stop = () => server.stop()
const database = new DatabaseSync(`drafts.sqlite`)
const initialBody = `A note from SQLite for document 1.`
database.prepare(`UPDATE drafts SET body = ? WHERE id = 1`).run(initialBody)
let browser
try {
	const origin = `http://127.0.0.1:${port}`
	const response = await fetch(origin)
	assert.equal(response.status, 200)
	const html = await response.text()
	assert.ok(html.includes(`A note from SQLite for document 1.`))
	assert.ok(html.indexOf(`data-resumable`) < html.indexOf(`<astro-island`))
	assert.equal((html.match(/data-resumable/g) ?? []).length, 2)
	assert.equal((html.match(/aria-busy="true"/g) ?? []).length, 0)
	browser = await chromium.launch()
	const page = await browser.newPage()
	const errors = []
	const scripts = []
	const rpcRequests = []
	page.on(`request`, (request) => {
		if (request.url().includes(`/api/trpc/`)) rpcRequests.push(request.url())
	})
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`console`, (message) => {
		if (message.type() === `error`) errors.push(message.text())
	})
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
	await page.evaluate(() => {
		window.__draftNodes = [...document.querySelectorAll(`textarea`)]
		window.__draftHost = document.querySelector(`astro-island`)
	})
	gate.resolve()
	await page.waitForSelector(`astro-island[client="load"]:not([ssr])`)
	assert.equal(
		await page.locator(`astro-island[client="visible"][ssr]`).count(),
		1,
	)
	await page
		.locator(`astro-island[client="visible"] .draft`)
		.first()
		.scrollIntoViewIfNeeded()
	await page.waitForSelector(`astro-island[client="visible"]:not([ssr])`)
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
	assert.equal(
		rpcRequests.length,
		0,
		`Hydration must consume the sidecar without RPC`,
	)
	const refresh = async (index, body) => {
		database.prepare(`UPDATE drafts SET body = ? WHERE id = 1`).run(body)
		const before = await cards
			.nth(index)
			.locator(`[data-revision]`)
			.textContent()
		await cards.nth(index).locator(`button`).click()
		await page.waitForFunction(
			(previous) =>
				document.querySelectorAll(`[data-revision]`)[previous.index]
					.textContent !== previous.before,
			{ index, before },
		)
		assert.equal(await cards.nth(index).locator(`textarea`).inputValue(), body)
	}
	await refresh(0, `Updated in SQLite after SSR`)
	await refresh(0, `Updated in SQLite again`)
	assert.equal(rpcRequests.length, 2)
	assert.deepEqual(
		(await page.locator(`[data-revision]`).allTextContents()).slice(1),
		seeds.slice(1),
	)
	await refresh(2, `Another database revision`)
	assert.equal(rpcRequests.length, 3)
	assert.equal(
		await cards.nth(0).locator(`textarea`).inputValue(),
		`Updated in SQLite again`,
	)
	if (process.env.TEMPLATE_SCREENSHOT)
		await page.screenshot({
			path: process.env.TEMPLATE_SCREENSHOT,
			fullPage: true,
		})
	await page.getByRole(`link`, { name: `How it works` }).click()
	await page.waitForURL(`**/about`)
	await page.waitForFunction(() => window.__draftHost.childNodes.length === 0)
	await page.getByRole(`link`, { name: `Back to drafts` }).click()
	await page.waitForSelector(`astro-island[client="load"]:not([ssr])`)
	assert.equal(
		await page.locator(`astro-island[client="visible"][ssr]`).count(),
		1,
	)
	await page
		.locator(`astro-island[client="visible"] .draft`)
		.first()
		.scrollIntoViewIfNeeded()
	await page.waitForSelector(`astro-island[client="visible"]:not([ssr])`)
	assert.equal(rpcRequests.length, 3, `Navigation hydration must also avoid RPC`)
	await refresh(0, `Refreshed after returning`)
	assert.equal(rpcRequests.length, 4)
	assert.deepEqual(errors, [])
	const executable = await Promise.all(scripts)
	assert.ok(executable.length > 0)
	for (const { code, url } of executable) {
		assert.doesNotMatch(url, /server\/(drafts|router)|read-draft\.sql/)
		assert.doesNotMatch(
			code,
			/node:sqlite|read-draft\.sql|SELECT id, title|A note from SQLite/,
		)
	}
	console.log(
		`${development ? `Development` : `Production`}: server data, client:load and client:visible, DOM-preserving SPA hydration, edits, fresh resets, family/island isolation, navigation cleanup, and server-code removal passed.`,
	)
} finally {
	await browser?.close()
	await stop()
	database.prepare(`UPDATE drafts SET body = ? WHERE id = 1`).run(initialBody)
	database.close()
}
