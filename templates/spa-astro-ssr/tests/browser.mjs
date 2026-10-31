import assert from "node:assert/strict"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { setTimeout } from "node:timers/promises"
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
	const cachedAt = Date.now()
	if (!development) {
		assert.equal(response.headers.get(`x-astro-cache`), `MISS`)
	}
	assert.ok(html.includes(`A note from SQLite for document 1.`))
	assert.ok(html.indexOf(`data-resumable`) < html.indexOf(`<astro-island`))
	assert.equal((html.match(/data-resumable/g) ?? []).length, 1)
	assert.equal((html.match(/aria-busy="true"/g) ?? []).length, 0)
	const changedBody = `Changed after the first server render`
	database.prepare(`UPDATE drafts SET body = ? WHERE id = 1`).run(changedBody)
	const repeated = await fetch(origin)
	const repeatedHtml = await repeated.text()
	assert.equal(repeated.status, 200)
	if (development) {
		assert.ok(repeatedHtml.includes(changedBody))
		assert.notEqual(repeatedHtml, html)
	} else {
		assert.equal(repeated.headers.get(`x-astro-cache`), `HIT`)
		assert.equal(
			repeatedHtml,
			html,
			`Cache hits preserve HTML and sidecar together`,
		)
	}
	browser = await chromium.launch()
	const page = await browser.newPage()
	const errors = []
	const scripts = []
	const rpcRequests = []
	const rpcResponses = []
	page.on(`request`, (request) => {
		if (request.url().includes(`/api/trpc/`)) rpcRequests.push(request.url())
	})
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`console`, (message) => {
		if (message.type() === `error`) errors.push(message.text())
	})
	page.on(`response`, (result) => {
		if (result.url().includes(`/api/trpc/`))
			rpcResponses.push(result.allHeaders())
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
	assert.equal(
		await page.locator(`textarea`).first().inputValue(),
		development ? changedBody : initialBody,
	)
	const seeds = await page.locator(`[data-revision]`).allTextContents()
	assert.equal(new Set(seeds).size, 2)
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
	// Edit before the delayed island activates. It must render live shared state.
	const cards = page.locator(`.draft`)
	await cards.nth(0).locator(`textarea`).fill(`A browser edit`)
	await page
		.locator(`astro-island[client="visible"] .draft`)
		.first()
		.scrollIntoViewIfNeeded()
	await page.waitForSelector(`astro-island[client="visible"]:not([ssr])`)
	assert.equal(
		await page.evaluate(() =>
			[...document.querySelectorAll(`textarea`)].every((element, index) =>
				index < 2
					? element === window.__draftNodes[index]
					: element !== window.__draftNodes[index],
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
	await cards.nth(0).locator(`textarea`).fill(`A browser edit`)
	await page.waitForFunction(
		() =>
			document.querySelector(`[data-preview]`).textContent === `A browser edit`,
	)
	assert.equal(
		await cards.nth(2).locator(`textarea`).inputValue(),
		`A browser edit`,
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
		(await page.locator(`[data-revision]`).allTextContents()).filter(
			(_, index) => index % 2 === 1,
		),
		[seeds[1], seeds[3]],
	)
	await refresh(2, `Another database revision`)
	assert.equal(rpcRequests.length, 3)
	assert.equal(
		await cards.nth(0).locator(`textarea`).inputValue(),
		`Another database revision`,
	)
	if (process.env.TEMPLATE_SCREENSHOT)
		await page.screenshot({
			path: process.env.TEMPLATE_SCREENSHOT,
			fullPage: true,
		})
	await cards.nth(0).locator(`textarea`).fill(`Keep this edit across navigation`)
	database
		.prepare(`UPDATE drafts SET body = ? WHERE id = 1`)
		.run(`A newer server value`)
	// Inspect incoming DOM before activation; new islands must mount fresh.
	await page.evaluate(() => {
		document.addEventListener(`astro:after-swap`, () => {
			window.__incomingNodes = [...document.querySelectorAll(`textarea`)]
		})
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
	assert.equal(
		rpcRequests.length,
		3,
		`Navigation must retain already initialized values without RPC`,
	)
	assert.equal(
		await cards.nth(0).locator(`textarea`).inputValue(),
		`Keep this edit across navigation`,
	)
	assert.equal(
		await cards.nth(2).locator(`textarea`).inputValue(),
		`Keep this edit across navigation`,
	)
	assert.ok(
		await page.evaluate(() =>
			[...document.querySelectorAll(`textarea`)].every(
				(node, index) => node !== window.__incomingNodes[index],
			),
		),
	)

	await refresh(0, `Refreshed after returning`)
	assert.equal(rpcRequests.length, 4)
	// A full load starts a new application; with no edits, both initial roots hydrate.
	const freshGate = Promise.withResolvers()
	await page.unroute(`**/*`)
	await page.route(`**/*`, async (route) => {
		if (route.request().resourceType() === `script`) await freshGate.promise
		await route.continue()
	})
	const fullLoad = await page.goto(origin, { waitUntil: `commit` })
	if (!development) assert.equal(fullLoad.headers()[`x-astro-cache`], `HIT`)
	await page.waitForSelector(`textarea`)
	await page.evaluate(() => {
		window.__pristineNodes = [...document.querySelectorAll(`textarea`)]
	})
	freshGate.resolve()
	await page.waitForSelector(`astro-island[client="load"]:not([ssr])`)
	await page
		.locator(`astro-island[client="visible"] .draft`)
		.first()
		.scrollIntoViewIfNeeded()
	await page.waitForSelector(`astro-island[client="visible"]:not([ssr])`)
	assert.equal(
		await page.locator(`textarea`).first().inputValue(),
		development ? `Refreshed after returning` : initialBody,
	)
	assert.ok(
		await page.evaluate(() =>
			[...document.querySelectorAll(`textarea`)].every(
				(node, index) => node === window.__pristineNodes[index],
			),
		),
	)
	assert.equal(rpcRequests.length, 4)

	// Even a new browser application resumed from the old cache can reset freshly.
	await refresh(0, `Fresh reset from a cached snapshot`)
	assert.equal(rpcRequests.length, 5)
	const rpcHeaders = await Promise.all(rpcResponses)
	assert.equal(rpcHeaders.length, 5)
	for (const headers of rpcHeaders) {
		assert.equal(headers[`cache-control`], `no-store`)
		assert.equal(headers[`x-astro-cache`], undefined)
		assert.equal(headers[`cdn-cache-control`], undefined)
	}
	if (!development) {
		const stillCached = await fetch(origin)
		assert.equal(stillCached.headers.get(`x-astro-cache`), `HIT`)
		assert.equal(
			await stillCached.text(),
			html,
			`RPC resets do not rewrite the SSR cache`,
		)
		// Exercise the real production TTL, without a test-only cache configuration.
		await setTimeout(Math.max(0, cachedAt + 61_000 - Date.now()))
		const expired = await fetch(origin)
		assert.equal(expired.headers.get(`x-astro-cache`), `MISS`)
		const freshHtml = await expired.text()
		assert.ok(freshHtml.includes(`Fresh reset from a cached snapshot`))
		assert.notEqual(freshHtml, html)
		const recached = await fetch(origin)
		assert.equal(recached.headers.get(`x-astro-cache`), `HIT`)
		assert.equal(await recached.text(), freshHtml)
	}

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
		`${development ? `Development` : `Production`}: ${development ? `uncached SSR` : `cached SSR and 60-second expiry`}, no-store RPC resets, server data, client:load and client:visible, initial DOM hydration, shared state, delayed fresh mounts, RPC resets, navigation without lost edits, and server-code removal passed.`,
	)
} finally {
	await browser?.close()
	await stop()
	database.prepare(`UPDATE drafts SET body = ? WHERE id = 1`).run(initialBody)
	database.close()
}
