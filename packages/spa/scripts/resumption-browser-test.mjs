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
	page.on(`pageerror`, (error) => errors.push(error.message))
	const gate = Promise.withResolvers()
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
	assert.deepEqual(errors, [])
	console.log(
		`${development ? `Development` : `Production`}: pure JSX props and an ordinary browser reader resume an Astro database constant without application atoms.`,
	)
} finally {
	await browser?.close()
	await stop()
}
