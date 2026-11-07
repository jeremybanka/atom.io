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
const database = new DatabaseSync(`inventory.sqlite`)
const initialStock = 24
database
	.prepare(`UPDATE products SET stock = ?, revision = 1 WHERE id = 1`)
	.run(initialStock)
const originalProductName = database
	.prepare(`SELECT name FROM products WHERE id = 2`)
	.get().name
const escapedProductName = `Breakfast tea "Ceylon" & <script>globalThis.__seedExecuted = true</script>`
database
	.prepare(`UPDATE products SET name = ? WHERE id = 2`)
	.run(escapedProductName)
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
	assert.ok(html.includes(`House blend`))
	assert.ok(html.includes(`value="24"`))
	assert.doesNotMatch(html, /<astro-resumption|<script[^>]*data-resumable/)
	assert.equal((html.match(/data-spa-resumption=/g) ?? []).length, 2)
	assert.equal((html.match(/aria-busy="true"/g) ?? []).length, 0)
	const changedStock = 27
	database
		.prepare(
			`UPDATE products SET stock = ?, revision = revision + 1 WHERE id = 1`,
		)
		.run(changedStock)
	const repeated = await fetch(origin)
	const repeatedHtml = await repeated.text()
	assert.equal(repeated.status, 200)
	if (development) {
		assert.ok(repeatedHtml.includes(`value="${changedStock}"`))
		assert.notEqual(repeatedHtml, html)
	} else {
		assert.equal(repeated.headers.get(`x-astro-cache`), `HIT`)
		assert.equal(
			repeatedHtml,
			html,
			`Cache hits preserve HTML and seed attributes together`,
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
		if (message.type() === `error` && !message.text().includes(`409 (Conflict)`))
			errors.push(message.text())
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
	await page.waitForSelector(`input[type="number"]`)
	assert.equal(await page.locator(`input[type="number"]`).count(), 4)
	assert.equal(
		await page.locator(`input[type="number"]`).first().inputValue(),
		String(development ? changedStock : initialStock),
	)
	const payloads = await page
		.locator(`astro-island`)
		.evaluateAll((islands) =>
			islands.map((island) =>
				JSON.parse(island.getAttribute(`data-spa-resumption`)),
			),
		)
	assert.equal(payloads.length, 2)
	assert.equal(payloads[0].values.length, 2)
	assert.equal(
		payloads[0].values.find((entry) => entry[0][1] === 2)[1][1].name,
		escapedProductName,
	)
	assert.equal(
		await page.locator(`.product h3`).nth(1).textContent(),
		escapedProductName,
	)
	assert.equal(await page.evaluate(() => globalThis.__seedExecuted), undefined)
	assert.deepEqual(
		payloads[1],
		payloads[0],
		`Cached shared reads still attach the complete seed to each island`,
	)
	const seeds = await page.locator(`[data-revision]`).allTextContents()
	assert.equal(seeds.length, 4)
	assert.equal(seeds[0], seeds[2])
	assert.equal(seeds[1], seeds[3])
	await page.evaluate(() => {
		window.__stockNodes = [...document.querySelectorAll(`input[type="number"]`)]
		window.__stockHost = document.querySelector(`astro-island`)
	})
	gate.resolve()
	await page.waitForSelector(`astro-island[client="load"]:not([ssr])`)
	assert.equal(
		await page.locator(`astro-island[client="visible"][ssr]`).count(),
		1,
	)
	// Edit before the delayed island activates. It must render live shared state.
	const cards = page.locator(`.product`)
	await cards.nth(0).locator(`input[type="number"]`).fill(`31`)
	await page
		.locator(`astro-island[client="visible"] .product`)
		.first()
		.scrollIntoViewIfNeeded()
	await page.waitForSelector(`astro-island[client="visible"]:not([ssr])`)
	assert.equal(
		await page.evaluate(() =>
			[...document.querySelectorAll(`input[type="number"]`)].every(
				(element, index) =>
					index < 2
						? element === window.__stockNodes[index]
						: element !== window.__stockNodes[index],
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
			.locator(`input[type="number"]`)
			.evaluateAll(
				(elements) => new Set(elements.map((element) => element.id)).size,
			),
		4,
	)
	await cards.nth(0).locator(`input[type="number"]`).fill(`31`)
	await page.waitForFunction(
		() =>
			document.querySelector(`[data-preview]`).textContent ===
			`31 units available`,
	)
	assert.equal(
		await cards.nth(2).locator(`input[type="number"]`).inputValue(),
		`31`,
	)
	assert.equal(
		rpcRequests.length,
		0,
		`Hydration must consume the island seed without RPC`,
	)
	const refresh = async (index, stock) => {
		database
			.prepare(
				`UPDATE products SET stock = ?, revision = revision + 1 WHERE id = 1`,
			)
			.run(stock)
		const before = await cards
			.nth(index)
			.locator(`[data-revision]`)
			.textContent()
		await cards
			.nth(index)
			.getByRole(`button`, { name: `Reload from database` })
			.click()
		await page.waitForFunction(
			(previous) =>
				document.querySelectorAll(`[data-revision]`)[previous.index]
					.textContent !== previous.before,
			{ index, before },
		)
		assert.equal(
			await cards.nth(index).locator(`input[type="number"]`).inputValue(),
			String(stock),
		)
	}
	await refresh(0, 29)
	await refresh(0, 30)
	assert.equal(rpcRequests.length, 2)
	assert.deepEqual(
		(await page.locator(`[data-revision]`).allTextContents()).filter(
			(_, index) => index % 2 === 1,
		),
		[seeds[1], seeds[3]],
	)
	await refresh(2, 35)
	assert.equal(rpcRequests.length, 3)
	assert.equal(
		await cards.nth(0).locator(`input[type="number"]`).inputValue(),
		`35`,
	)
	if (process.env.TEMPLATE_SCREENSHOT)
		await page.screenshot({
			path: process.env.TEMPLATE_SCREENSHOT,
			fullPage: true,
		})
	await cards.nth(0).locator(`input[type="number"]`).fill(`41`)
	database
		.prepare(
			`UPDATE products SET stock = ?, revision = revision + 1 WHERE id = 1`,
		)
		.run(43)
	// Inspect incoming DOM before activation; new islands must mount fresh.
	await page.evaluate(() => {
		document.addEventListener(`astro:after-swap`, () => {
			window.__incomingNodes = [
				...document.querySelectorAll(`input[type="number"]`),
			]
		})
	})
	await page.getByRole(`link`, { name: `How it works` }).click()
	await page.waitForURL(`**/about`)
	await page.waitForFunction(() => window.__stockHost.childNodes.length === 0)
	await page.getByRole(`link`, { name: `Back to inventory` }).click()
	await page.waitForSelector(`astro-island[client="load"]:not([ssr])`)
	assert.equal(
		await page.locator(`astro-island[client="visible"][ssr]`).count(),
		1,
	)
	await page
		.locator(`astro-island[client="visible"] .product`)
		.first()
		.scrollIntoViewIfNeeded()
	await page.waitForSelector(`astro-island[client="visible"]:not([ssr])`)
	assert.equal(
		rpcRequests.length,
		3,
		`Navigation must retain already initialized values without RPC`,
	)
	assert.equal(
		await cards.nth(0).locator(`input[type="number"]`).inputValue(),
		`41`,
	)
	assert.equal(
		await cards.nth(2).locator(`input[type="number"]`).inputValue(),
		`41`,
	)
	assert.ok(
		await page.evaluate(() =>
			[...document.querySelectorAll(`input[type="number"]`)].every(
				(node, index) => node !== window.__incomingNodes[index],
			),
		),
	)

	await refresh(0, 45)
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
	await page.waitForSelector(`input[type="number"]`)
	await page.evaluate(() => {
		window.__pristineNodes = [
			...document.querySelectorAll(`input[type="number"]`),
		]
	})
	// Hold the earlier island off-DOM so the later, cached SSR reader activates first.
	await page.evaluate(() => {
		window.__heldIsland = document.querySelector(`astro-island[client="load"]`)
		window.__heldParent = window.__heldIsland.parentElement
		window.__heldIsland.remove()
	})
	await page
		.locator(`astro-island[client="visible"] .product`)
		.first()
		.scrollIntoViewIfNeeded()
	freshGate.resolve()
	await page.waitForSelector(`astro-island[client="visible"]:not([ssr])`)
	assert.equal(
		await page.evaluate(() => window.__heldIsland.hasAttribute(`ssr`)),
		true,
	)
	await page.evaluate(() => window.__heldParent.append(window.__heldIsland))
	await page.waitForSelector(`astro-island[client="load"]:not([ssr])`)
	await page
		.locator(`astro-island[client="visible"] .product`)
		.first()
		.scrollIntoViewIfNeeded()
	await page.waitForSelector(`astro-island[client="visible"]:not([ssr])`)
	assert.equal(
		await page.locator(`input[type="number"]`).first().inputValue(),
		String(development ? 45 : initialStock),
	)
	assert.ok(
		await page.evaluate(() =>
			[...document.querySelectorAll(`input[type="number"]`)].every(
				(node, index) => node === window.__pristineNodes[index],
			),
		),
	)
	assert.equal(rpcRequests.length, 4)

	// Even a new browser application resumed from the old cache can reset freshly.
	await refresh(0, 48)
	assert.equal(rpcRequests.length, 5)
	// Saving persists a counted quantity and publishes its real database revision.
	await cards.nth(0).locator(`input[type="number"]`).fill(`32`)
	await cards.nth(0).getByRole(`button`, { name: `Save stock` }).click()
	await page.waitForFunction(
		() =>
			document.querySelector(`[role="status"]`).textContent === `Stock saved`,
	)
	assert.equal(
		database.prepare(`SELECT stock FROM products WHERE id = 1`).get().stock,
		32,
	)
	assert.equal(
		await cards.nth(2).locator(`input[type="number"]`).inputValue(),
		`32`,
	)
	// A competing count must produce a conflict instead of being overwritten.
	database
		.prepare(
			`UPDATE products SET stock = 37, revision = revision + 1 WHERE id = 1`,
		)
		.run()
	await cards.nth(0).locator(`input[type="number"]`).fill(`33`)
	await cards.nth(0).getByRole(`button`, { name: `Save stock` }).click()
	await page.waitForFunction(() =>
		document
			.querySelector(`[role="status"]`)
			.textContent.includes(`Reload before saving`),
	)
	assert.equal(
		database.prepare(`SELECT stock FROM products WHERE id = 1`).get().stock,
		37,
	)
	await cards
		.nth(0)
		.getByRole(`button`, { name: `Reload from database` })
		.click()
	await page.waitForFunction(
		() => document.querySelector(`input[type="number"]`).value === `37`,
	)
	assert.equal(rpcRequests.length, 8)
	const rpcHeaders = await Promise.all(rpcResponses)
	assert.equal(rpcHeaders.length, 8)
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
		assert.ok(freshHtml.includes(`value="37"`))
		assert.notEqual(freshHtml, html)
		const recached = await fetch(origin)
		assert.equal(recached.headers.get(`x-astro-cache`), `HIT`)
		assert.equal(await recached.text(), freshHtml)
	}

	assert.deepEqual(errors, [])
	const executable = await Promise.all(scripts)
	assert.ok(executable.length > 0)
	for (const { code, url } of executable) {
		assert.doesNotMatch(url, /server\/(inventory|router)|read-product\.sql/)
		assert.doesNotMatch(
			code,
			/node:sqlite|read-product\.sql|SELECT id, sku|House blend/,
		)
	}
	console.log(
		`${development ? `Development` : `Production`}: ${development ? `uncached SSR` : `cached SSR and 60-second expiry`}, no-store RPC reads and saves, competing-save conflicts, server data, client:load and client:visible, initial DOM hydration, shared state, delayed fresh mounts, RPC resets, navigation without lost edits, wrapper-free seeds, reverse hydration order, and server-code removal passed.`,
	)
} finally {
	await browser?.close()
	await stop()
	database
		.prepare(`UPDATE products SET stock = ?, revision = 1 WHERE id = 1`)
		.run(initialStock)
	database
		.prepare(`UPDATE products SET name = ? WHERE id = 2`)
		.run(originalProductName)
	database.close()
}
