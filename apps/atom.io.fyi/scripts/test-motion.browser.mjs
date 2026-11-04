import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { dev } from "astro"
import { chromium } from "playwright"

let browser, server, page
const cacheDir = await mkdtemp(join(tmpdir(), `spa-motion-sandbox-`))
try {
	server = await dev({
		root: resolve(import.meta.dirname, `..`),
		server: { host: `127.0.0.1`, port: 0 },
		vite: { cacheDir },
		logLevel: `error`,
		devToolbar: { enabled: false },
	})
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		args: [`--enable-unsafe-swiftshader`],
	})
	page = await browser.newPage({
		viewport: { width: 1240, height: 1120 },
		acceptDownloads: true,
	})
	const errors = []
	page.on(`console`, (msg) => {
		if ([`error`, `warn`].includes(msg.type())) console.error(msg.text())
	})
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
		console.error(error.stack)
	})
	await page.goto(`http://127.0.0.1:${server.address.port}/spa-motion-lab`)
	await page.screenshot({ path: `/tmp/spa-motion-initial.png`, fullPage: true })
	await writeFile(`/tmp/spa-motion-page.html`, await page.content())
	await page.waitForFunction(
		() => document.querySelector(`motion-sandbox`)?.dataset.frames > 1,
	)
	assert.equal(await page.inputValue(`#motion-duration`), `2`)
	await page.evaluate(() => {
		window.motionCard = document.querySelector(`motion-card`)
	})
	await page.locator(`#motion-replay`).click()
	await page.waitForFunction(() => {
		const trace = document.querySelector(`motion-sandbox`).capture()
		return (
			trace.markers.some((mark) => mark.label === `turn`) &&
			trace.samples.at(-1)?.phase === `visible`
		)
	})
	const capture = await page.evaluate(() =>
		document.querySelector(`motion-sandbox`).capture(),
	)
	const reentry = capture.markers.find((mark) => mark.label === `re-entry`)
	assert.ok(reentry)
	const before = capture.samples.filter((at) => at.time <= reentry.time).at(-1)
	const returning = capture.samples.filter(
		(at) => at.time > reentry.time && at.phase === `returning`,
	)
	assert.ok(before.velocity > 0)
	assert.ok(
		returning.some((at) => at.x > before.x + 2),
		`Card must continue outward while braking`,
	)
	assert.ok(
		returning.some((at) => at.velocity < 0),
		`Card must reverse before returning home`,
	)
	assert.equal(new Set(capture.samples.map((at) => at.instance)).size, 1)
	assert.equal(
		await page.evaluate(
			() => document.querySelector(`motion-card`) === window.motionCard,
		),
		true,
	)
	assert.ok(Math.abs(capture.samples.at(-1).x) < 0.05)
	await writeFile(
		`/tmp/spa-motion-capture.json`,
		JSON.stringify(capture, null, 2),
	)
	// Scrubbing reviews recorded frames without changing the live node's transform.
	const transform = await page
		.locator(`motion-card`)
		.evaluate((node) => node.style.transform)
	await page.locator(`#motion-scrub`).evaluate((input) => {
		input.value = String(Math.floor(Number(input.max) / 2))
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
	})
	assert.equal(
		await page.locator(`motion-sandbox`).getAttribute(`data-reviewing`),
		`true`,
	)
	assert.equal(
		await page.locator(`motion-card`).evaluate((node) => node.style.transform),
		transform,
	)
	await page.screenshot({ path: `/tmp/spa-motion-sandbox.png`, fullPage: true })
	const pngWait = page.waitForEvent(`download`)
	await page.locator(`#motion-png`).click()
	const png = await pngWait
	await png.saveAs(`/tmp/spa-motion-sequence.png`)
	assert.equal(
		(await readFile(`/tmp/spa-motion-sequence.png`)).subarray(1, 4).toString(),
		`PNG`,
	)
	const jsonWait = page.waitForEvent(`download`)
	await page.locator(`#motion-json`).click()
	const json = await jsonWait
	const jsonPath = await json.path()
	assert.deepEqual(JSON.parse(await readFile(jsonPath, `utf8`)), capture)
	await page.locator(`#motion-live`).click()
	await page.locator(`#motion-duration`).evaluate((input) => {
		input.value = `0.5`
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
	})
	await page.locator(`#motion-replay`).click()
	await page.waitForFunction(() => {
		const trace = document.querySelector(`motion-sandbox`).capture()
		return (
			trace.settings.duration === 0.5 &&
			trace.markers.some((mark) => mark.label === `turn`) &&
			trace.samples.at(-1)?.phase === `visible`
		)
	})
	// Interrupt return once more, then force final removal and mount a new generation.
	await page.locator(`#motion-toggle`).click()
	await page.waitForFunction(
		() =>
			document.querySelector(`motion-sandbox`).capture().samples.at(-1)?.x > 20,
	)
	await page.locator(`#motion-toggle`).click()
	await page.waitForTimeout(40)
	await page.locator(`#motion-toggle`).click()
	await page.waitForFunction(() => !document.querySelector(`motion-card`))
	await page.locator(`#motion-toggle`).click()
	await page.waitForFunction(
		() =>
			document.querySelector(`motion-sandbox`).capture().samples.at(-1)
				?.instance === 2,
	)
	assert.equal(
		await page.evaluate(
			() => document.querySelector(`motion-card`) === window.motionCard,
		),
		false,
	)
	await page.setViewportSize({ width: 390, height: 844 })
	await page.waitForTimeout(100)
	assert.equal(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
		true,
	)
	await page.screenshot({
		path: `/tmp/spa-motion-sandbox-mobile.png`,
		fullPage: true,
	})
	assert.deepEqual(errors, [])
	console.log(
		`Motion sandbox passed: 2s default, adjustable speed, velocity-preserving U-turn, repeated interruption, retained identity, trace/scrub, PNG/JSON capture, disposal, and mobile layout.`,
	)
} catch (error) {
	if (page)
		await page
			.screenshot({ path: `/tmp/spa-motion-failure.png`, fullPage: true })
			.catch(() => {})
	throw error
} finally {
	await browser?.close()
	await server?.stop()
	await rm(cacheDir, { recursive: true, force: true })
}
