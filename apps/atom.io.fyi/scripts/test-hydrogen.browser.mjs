import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createServer } from "node:http"
import { extname, join, resolve } from "node:path"
import { dev } from "astro"
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
let browser, devServer, cacheDir
try {
	if (process.argv.includes(`--dev`)) {
		cacheDir = await mkdtemp(join(tmpdir(), `hydrogen-site-dev-`))
		devServer = await dev({
			root: resolve(import.meta.dirname, `..`),
			server: { host: `127.0.0.1`, port: 0 },
			vite: { cacheDir },
			logLevel: `error`,
		})
	} else {
		await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
	}
	browser = await chromium.launch({ args: [`--enable-unsafe-swiftshader`] })
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	const iframeRequests = []
	page.on(`request`, (request) => {
		if (request.isNavigationRequest() && request.frame().parentFrame()) {
			iframeRequests.push(request.url())
		}
	})
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
	const base = `http://127.0.0.1:${devServer?.address.port ?? server.address().port}`
	await page.context().grantPermissions([`clipboard-read`, `clipboard-write`])
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
	const copiedCode = await page
		.locator(`code-block pre code`)
		.first()
		.textContent()
	await page.locator(`code-block > file-name > button`).first().click()
	await page.waitForFunction(
		async (expected) => (await navigator.clipboard.readText()) === expected,
		copiedCode,
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
	const panel = page.locator(`[data-testid="atom-io-devtools"]`)
	await page.locator(`button[aria-label="Expand headings"]`).click()
	await page.locator(`button[aria-label="Expand 0"]`).click()
	const rowHeights = await panel
		.locator(`.state-leaf > .json-editor > header`)
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height))
	assert.ok(rowHeights.length >= 4)
	assert.ok(
		rowHeights.every((height) => height === 22),
		`State rows must retain the original 22px density: ${rowHeights.join(`, `)}`,
	)
	const nestedHeights = await panel
		.locator(`.property > .json-editor > header`)
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height))
	assert.ok(nestedHeights.length > 20)
	assert.ok(
		nestedHeights.every((height) => height === 21),
		`Nested JSON rows must be 21px: ${nestedHeights.join(`, `)}`,
	)
	assert.equal(
		await panel
			.locator(`.toolbar`)
			.evaluate((element) => element.getBoundingClientRect().height),
		28,
	)
	await page.emulateMedia({ colorScheme: `dark` })
	assert.equal(
		await panel.evaluate((element) => getComputedStyle(element).backgroundColor),
		`rgb(17, 17, 17)`,
	)
	await panel.screenshot({ path: `/tmp/hydrogen-devtools-dense-dark.png` })
	await page.emulateMedia({ colorScheme: `light` })
	assert.equal(
		await panel.evaluate((element) => getComputedStyle(element).backgroundColor),
		`rgb(221, 221, 221)`,
	)
	await panel.screenshot({ path: `/tmp/hydrogen-devtools-dense-light.png` })
	const handle = page.locator(`button[aria-label="Move debugger"]`)
	const bounds = await handle.boundingBox()
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	)
	await page.mouse.down()
	await page.mouse.move(
		bounds.x + bounds.width / 2 - 40,
		bounds.y + bounds.height / 2 - 30,
		{ steps: 4 },
	)
	await page.mouse.up()
	await page.waitForFunction(
		() =>
			document.querySelector(`[data-testid="atom-io-devtools"]`).style
				.transform === `translate(-40px, -30px)`,
	)
	await handle.focus()
	await page.keyboard.press(`ArrowLeft`)
	await page.waitForFunction(
		() =>
			document.querySelector(`[data-testid="atom-io-devtools"]`).style
				.transform === `translate(-50px, -30px)`,
	)

	await page.screenshot({
		path: `/tmp/hydrogen-site-desktop.png`,
		fullPage: false,
	})
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
	await page.screenshot({
		path: `/tmp/hydrogen-site-mobile.png`,
		fullPage: false,
	})
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
	assert.deepEqual(
		iframeRequests,
		[],
		`Navigation must not mount hidden copies of the page`,
	)
	console.log(
		`Site browser checks passed: compact rows and themes, hydration, code copying, shared-store editing, pointer dragging, persisted navigation, mobile menu, Three.js lifecycle, fresh navigation, reload.`,
	)
} finally {
	await browser?.close()
	if (devServer) await devServer.stop()
	if (server.listening) await new Promise((done) => server.close(done))
	if (cacheDir) await rm(cacheDir, { recursive: true, force: true })
}
