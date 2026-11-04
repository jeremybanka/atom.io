import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createServer } from "vite"
import { chromium } from "playwright"

let browser, server, page
const cacheDir = await mkdtemp(join(tmpdir(), `spa-motion-sandbox-`))
try {
	server = await createServer({
		configFile: resolve(
			import.meta.dirname,
			`../examples/motion/vite.config.ts`,
		),
		server: { host: `127.0.0.1`, port: 0 },
		cacheDir,
		logLevel: `error`,
	})
	await server.listen()
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
	await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
	await page.screenshot({ path: `/tmp/spa-motion-initial.png`, fullPage: true })
	await writeFile(`/tmp/spa-motion-page.html`, await page.content())
	await page.waitForFunction(
		() => document.querySelector(`motion-sandbox`)?.dataset.frames > 1,
	)
	assert.equal(await page.inputValue(`#motion-duration`), `2`)
	await page.evaluate(() => {
		window.motionCard = document.querySelector(`motion-sandbox motion-card`)
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
			() =>
				document.querySelector(`motion-sandbox motion-card`) ===
				window.motionCard,
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
		.locator(`motion-sandbox motion-card`)
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
		await page
			.locator(`motion-sandbox motion-card`)
			.evaluate((node) => node.style.transform),
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
	await page.waitForFunction(
		() => !document.querySelector(`motion-sandbox motion-card`),
	)
	await page.locator(`#motion-toggle`).click()
	await page.waitForFunction(
		() =>
			document.querySelector(`motion-sandbox`).capture().samples.at(-1)
				?.instance === 2,
	)
	assert.equal(
		await page.evaluate(
			() =>
				document.querySelector(`motion-sandbox motion-card`) ===
				window.motionCard,
		),
		false,
	)
	// A typical notification dismisses quickly, but reverses scale and opacity
	// on the same instance when its dismissal is interrupted.
	assert.equal(await page.inputValue(`#toast-duration`), `0.24`)
	await page.evaluate(() => {
		window.toastCard = document.querySelector(`toast-sandbox motion-card`)
	})
	await page.locator(`#toast-replay`).click()
	await page.waitForFunction(() => {
		const trace = document.querySelector(`toast-sandbox`).capture()
		return (
			trace.markers.some((mark) => mark.label === `turn`) &&
			trace.samples.at(-1)?.phase === `visible`
		)
	})
	const toastCapture = await page.evaluate(() =>
		document.querySelector(`toast-sandbox`).capture(),
	)
	assert.equal(
		toastCapture.markers.find((mark) => mark.label === `exit`).settings.type,
		`tween`,
	)
	assert.equal(
		toastCapture.markers.find((mark) => mark.label === `re-entry`).settings.type,
		`spring`,
	)

	assert.ok(
		toastCapture.samples.some((at) => at.scale < 0.98 && at.opacity < 0.8),
		`Dismissal must shrink and fade the toast`,
	)
	const toastReturning = toastCapture.samples.filter(
		(at) => at.phase === `returning`,
	)
	assert.ok(
		toastReturning.some((at) => at.velocity < -0.001),
		`Return must carry the shrinking velocity before turning`,
	)
	assert.ok(
		toastReturning.some((at) => at.velocity > 0.001),
		`The toast must expand again`,
	)
	assert.ok(
		toastReturning.some((at) => at.scale > 1.0005),
		`The spring must visibly rebound past its resting scale`,
	)
	assert.equal(new Set(toastCapture.samples.map((at) => at.instance)).size, 1)
	assert.equal(
		await page.evaluate(
			() =>
				document.querySelector(`toast-sandbox motion-card`) === window.toastCard,
		),
		true,
	)
	const restoredToast = toastCapture.samples.at(-1)
	assert.ok(Math.abs(restoredToast.scale - 1) < 0.0001)
	assert.ok(Math.abs(restoredToast.opacity - 1) < 0.00001)
	await writeFile(
		`/tmp/spa-motion-toast.json`,
		JSON.stringify(toastCapture, null, 2),
	)
	await page
		.locator(`toast-sandbox`)
		.screenshot({ path: `/tmp/spa-motion-toast-live.png` })
	await page.locator(`#toast-scrub`).evaluate((input) => {
		input.value = String(Math.floor(Number(input.max) * 0.25))
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
	})
	await page
		.locator(`toast-sandbox`)
		.screenshot({ path: `/tmp/spa-motion-toast.png` })
	const toastPNGWait = page.waitForEvent(`download`)
	await page.locator(`#toast-png`).click()
	await (await toastPNGWait).saveAs(`/tmp/spa-motion-toast-sequence.png`)
	await page.locator(`#toast-live`).click()
	await page.locator(`#toast-toggle`).click()
	await page.waitForFunction(
		() => !document.querySelector(`toast-sandbox motion-card`),
	)
	const dismissedToast = await page.evaluate(() =>
		document.querySelector(`toast-sandbox`).capture(),
	)
	assert.ok(
		dismissedToast.samples.some((at) => at.scale <= 0.86 && at.opacity < 0.02),
		`An uninterrupted dismissal must reach the 85% scale and fade away`,
	)
	await page.locator(`#toast-toggle`).click()
	await page.waitForFunction(
		() =>
			document.querySelector(`toast-sandbox`).capture().samples.at(-1)
				?.instance === 2,
	)
	// Slow motion uses the same targets and keeps the original instance on return.
	await page.locator(`#toast-duration`).evaluate((input) => {
		input.value = `1`
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
	})
	await page.locator(`#toast-replay`).click()
	await page.waitForFunction(() => {
		const trace = document.querySelector(`toast-sandbox`).capture()
		return (
			trace.settings.duration === 1 &&
			trace.markers.some((mark) => mark.label === `turn`) &&
			trace.samples.at(-1)?.phase === `visible`
		)
	})
	assert.equal(
		await page.evaluate(
			() =>
				new Set(
					document
						.querySelector(`toast-sandbox`)
						.capture()
						.samples.map((at) => at.instance),
				).size,
		),
		1,
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
		`Motion sandbox passed: 2s default, adjustable speed, velocity-preserving U-turn, repeated interruption, retained identity, trace/scrub, PNG/JSON capture, disposal, interrupted toast shrink/fade/spring return, and mobile layout.`,
	)
} catch (error) {
	if (page)
		await page
			.screenshot({ path: `/tmp/spa-motion-failure.png`, fullPage: true })
			.catch(() => {})
	throw error
} finally {
	await browser?.close()
	await server?.close()
	await rm(cacheDir, { recursive: true, force: true })
}
