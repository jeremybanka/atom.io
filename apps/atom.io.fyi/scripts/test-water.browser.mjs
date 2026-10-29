import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve } from "node:path"
import { chromium } from "playwright"

const directory = resolve(import.meta.dirname, `../dist/client`)
const server = createServer(async (request, response) => {
	const pathname = decodeURIComponent(
		new URL(request.url, `http://localhost`).pathname,
	)
	const file = resolve(
		directory,
		`.${pathname}${extname(pathname) ? `` : `${pathname.endsWith(`/`) ? `` : `/`}index.html`}`,
	)
	if (!file.startsWith(`${directory}/`)) {
		response.writeHead(403).end()
		return
	}
	try {
		const data = await readFile(file)
		response.setHeader(
			`content-type`,
			{
				".html": `text/html`,
				".js": `application/javascript`,
				".css": `text/css`,
			}[extname(file)] ?? `application/octet-stream`,
		)
		response.end(data)
	} catch {
		response.writeHead(404).end()
	}
})
await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
let browser
try {
	browser = await chromium.launch({ args: [`--enable-unsafe-swiftshader`] })
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
		console.error(error)
	})
	page.on(`console`, (message) => {
		if (message.type() === `error`) {
			errors.push(message.text())
			console.error(message.text())
		}
	})
	const base = `http://127.0.0.1:${server.address().port}`
	await page.goto(`${base}/docs/getting-started`)
	await page.waitForFunction(
		() => document.querySelectorAll(`astro-island:not([ssr])`).length === 3,
	)
	await page.waitForFunction(
		() => document.querySelectorAll(`on-this-page a`).length > 0,
	)
	assert.equal(
		await page.locator(`docs-navigation`).getAttribute(`data-pathname`),
		`/docs/getting-started`,
	)
	assert.equal(
		await page
			.locator(`code-block pre code`)
			.first()
			.textContent()
			.then((value) => value.length > 0),
		true,
	)
	await page.evaluate(() => {
		window.testNavigation = document.querySelector(`docs-navigation`)
		window.testLogo = document.querySelector(`dz2-orbital canvas`)
	})
	await page.keyboard.press(`Control+Shift+A`)
	await page
		.locator(`[data-testid="atom-io-devtools"]`)
		.waitFor({ state: `visible` })
	const toggle = page.locator(`input[aria-label="menuToggle"]`)
	await toggle.check()
	await page.waitForFunction(
		() =>
			document
				.querySelector(`site-directory`)
				?.getAttribute(`data-user-has-toggled`) === `true`,
	)
	await page.screenshot({ path: `/tmp/water-site-desktop.png`, fullPage: false })
	await page.keyboard.press(`Control+Shift+A`)
	await page.locator(`site-directory a[href="/docs/concepts"]`).click()
	await page.waitForURL(`**/docs/concepts`)
	await page.waitForFunction(
		() =>
			document
				.querySelector(`docs-navigation`)
				?.getAttribute(`data-pathname`) === `/docs/concepts`,
	)
	assert.equal(
		await page.evaluate(
			() => window.testNavigation === document.querySelector(`docs-navigation`),
		),
		true,
	)
	assert.equal(
		await page.evaluate(
			() => window.testLogo === document.querySelector(`dz2-orbital canvas`),
		),
		true,
	)
	await page.waitForFunction(
		() => document.querySelector(`on-this-page a`)?.textContent !== ``,
	)
	await page.keyboard.press(`Control+Shift+A`)
	await toggle.uncheck()
	await page.keyboard.press(`Control+Shift+A`)
	await page.setViewportSize({ width: 390, height: 844 })
	await page.locator(`menu-toggle button`).click()
	await page.waitForFunction(
		() =>
			document
				.querySelector(`site-directory`)
				?.getAttribute(`data-user-has-toggled`) === `true`,
	)
	await page.screenshot({ path: `/tmp/water-site-mobile.png`, fullPage: false })
	await page.locator(`app-shell > header a[href="/"]`).click()
	await page.waitForURL(`${base}/`)
	await page.waitForFunction(
		() => document.querySelectorAll(`dz2-orbital canvas`).length === 2,
	)
	await page.locator(`app-shell > header a[href="/docs"]`).click()
	await page.waitForURL(`${base}/docs`)
	await page.waitForFunction(
		() =>
			document
				.querySelector(`docs-navigation`)
				?.getAttribute(`data-pathname`) === `/docs`,
	)
	assert.equal(
		await page.evaluate(
			() => window.testNavigation === document.querySelector(`docs-navigation`),
		),
		false,
	)
	assert.equal(
		await page.evaluate(
			() => window.testLogo === document.querySelector(`dz2-orbital canvas`),
		),
		true,
	)
	await page.reload()
	await page.waitForFunction(
		() => document.querySelectorAll(`astro-island:not([ssr])`).length === 3,
	)
	assert.deepEqual(errors, [])
	console.log(
		`Site browser checks passed: hydration, shared-store editing, persisted navigation, mobile menu, Three.js lifecycle, fresh navigation, reload.`,
	)
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
