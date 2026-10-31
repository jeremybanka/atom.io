import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve } from "node:path"

import { dev } from "astro"
import { chromium } from "playwright"

const fixture = resolve(import.meta.dirname, `../__tests__/astro`)
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
			`.${pathname === `/` ? `/index.html` : pathname}`,
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
	const initial = await fetch(origin)
	const html = await initial.text()
	assert.equal(initial.status, 200, html.slice(0, 2000))
	assert.ok(html.indexOf(`data-resumable`) < html.indexOf(`<section`))
	assert.equal(
		(html.match(/<output\b[^>]*>SERVER_ONLY_SQLITE_SENTINEL:1<\/output>/g) ?? [])
			.length,
		2,
	)
	browser = await chromium.launch()
	const page = await browser.newPage()
	const errors = []
	const scripts = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`response`, (response) => {
		if (response.request().resourceType() === `script`) {
			scripts.push(
				response.text().then((code) => ({ code, url: response.url() })),
			)
		}
	})
	await page.goto(origin)
	await page.waitForSelector(`astro-resumption[data-ready]`)
	const roots = page.locator(`astro-resumption`)
	assert.equal(await roots.count(), 2)
	assert.deepEqual(await page.locator(`output`).allTextContents(), [
		`SERVER_ONLY_SQLITE_SENTINEL:1`,
		`SERVER_ONLY_SQLITE_SENTINEL:1`,
	])
	await roots.nth(0).locator(`button`).click()
	assert.deepEqual(await page.locator(`output`).allTextContents(), [
		`client:1:1`,
		`SERVER_ONLY_SQLITE_SENTINEL:1`,
	])
	await roots.nth(0).locator(`button`).click()
	await roots.nth(1).locator(`button`).click()
	assert.deepEqual(await page.locator(`output`).allTextContents(), [
		`client:1:2`,
		`client:1:1`,
	])
	assert.deepEqual(errors, [])
	const executable = await Promise.all(scripts)
	assert.ok(executable.length > 0)
	for (const { code, url } of executable) {
		assert.doesNotMatch(url, /database\.server|\/spa\//)
		assert.doesNotMatch(
			code,
			/node:sqlite|SERVER_ONLY_SQLITE_SENTINEL|database\.server|@atom\.io\/spa/,
		)
	}
	console.log(
		`${development ? `Development` : `Production`}: SSR SQLite values, isolated browser seeds, repeated atom resets, and server-code removal passed.`,
	)
} finally {
	await browser?.close()
	await stop()
}
