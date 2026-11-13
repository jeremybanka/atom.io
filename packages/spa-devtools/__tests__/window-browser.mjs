import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { cpus, platform, arch } from "node:os"
import { resolve } from "node:path"

import { build } from "esbuild"
import { chromium } from "playwright"

const artifacts =
	process.env.SPA_DEVTOOLS_BROWSER_ARTIFACTS ?? `/tmp/spa-devtools-window`
await mkdir(artifacts, { recursive: true })
const bundle = await build({
	entryPoints: [resolve(import.meta.dirname, `fixtures/window-browser/main.ts`)],
	tsconfigRaw: {},
	bundle: true,
	write: false,
	format: `esm`,
	platform: `browser`,
	define: { "import.meta.env.DEV": `false` },
})
const css = await readFile(
	resolve(import.meta.dirname, `../dist/devtools.css`),
	`utf8`,
)
const server = createServer((req, res) => {
	res.setHeader(
		`content-type`,
		req.url === `/app.js` ? `application/javascript` : `text/html`,
	)
	res.end(
		req.url === `/app.js`
			? bundle.outputFiles[0].text
			: `<style>${css}</style><script type="module" src="/app.js"></script>`,
	)
})
await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
let browser
try {
	browser = await chromium.launch({
		chromiumSandbox: true,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
	})
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	})
	await context.tracing.start({ screenshots: true, snapshots: true })
	const page = await context.newPage()
	const errors = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	await page.goto(`http://127.0.0.1:${server.address().port}`)
	const panel = page.locator(`main[data-css="spa-devtools"]`)
	const move = page.getByRole(`button`, { name: `Move debugger`, exact: true })
	const input = page.getByRole(`textbox`, { name: `count`, exact: true })
	await input.fill(`2.`)
	await input.evaluate((node) => {
		window.retainedInput = node
	})
	assert.equal(await page.evaluate(() => window.devtoolsWindowTest.value()), 2)
	const free = await panel.boundingBox()
	// Real captured pointer drag, then Escape: original rectangle and input identity survive.
	let handle = await move.boundingBox()
	await page.mouse.move(
		handle.x + handle.width / 2,
		handle.y + handle.height / 2,
	)
	await page.mouse.down()
	await page.mouse.move(600, 220, { steps: 12 })
	await page.keyboard.press(`Escape`)
	await page.mouse.up()
	assert.deepEqual(await panel.boundingBox(), free)
	assert.equal(
		await input.evaluate(
			(node) => node === window.retainedInput && node.value === `2.`,
		),
		true,
	)
	// Physical edge/corner resizing, each followed by cancellation.
	for (const edge of [`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`]) {
		const box = await page.locator(`[data-resize="${edge}"]`).boundingBox()
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x - 35, box.y + 30, { steps: 3 })
		await page.keyboard.press(`Escape`)
		await page.mouse.up()
		assert.deepEqual(await panel.boundingBox(), free)
	}
	// Every menu target has an exact viewport rectangle, and Restore returns the free rectangle.
	const targets = [
		[`Left half`, 0, 0, 720, 900],
		[`Right half`, 720, 0, 720, 900],
		[`Left third`, 0, 0, 480, 900],
		[`Center third`, 480, 0, 480, 900],
		[`Right third`, 960, 0, 480, 900],
		[`Top half`, 0, 0, 1440, 450],
		[`Bottom half`, 0, 450, 1440, 450],
		[`Full viewport`, 0, 0, 1440, 900],
	]
	for (const [label, x, y, width, height] of targets) {
		await page
			.getByRole(`button`, { name: `Debugger layout`, exact: true })
			.click()
		await page.getByRole(`button`, { name: label, exact: true }).click()
		assert.deepEqual(await panel.boundingBox(), { x, y, width, height })
		const stored = await page.evaluate(() =>
			localStorage.getItem(`🔍 Devtools Window`),
		)
		await move.click()
		assert.deepEqual(await panel.boundingBox(), { x, y, width, height })
		assert.equal(
			await page.evaluate(() => localStorage.getItem(`🔍 Devtools Window`)),
			stored,
		)
		await page
			.getByRole(`button`, { name: `Debugger layout`, exact: true })
			.click()
		await page.getByRole(`button`, { name: `Restore free position` }).click()
		assert.deepEqual(await panel.boundingBox(), free)
	}
	// Drag through the palette: the painted preview and final physical bounds agree.
	handle = await move.boundingBox()
	await page.mouse.move(handle.x + 7, handle.y + 10)
	await page.mouse.down()
	await page.mouse.move(handle.x - 10, handle.y + 10)
	await page.locator(`.snap-palette`).waitFor({ state: `visible` })
	const target = await page
		.getByRole(`button`, { name: `Right third`, exact: true })
		.boundingBox()
	await page.mouse.move(
		target.x + target.width / 2,
		target.y + target.height / 2,
		{ steps: 12 },
	)
	await page.locator(`.snap-preview:not([hidden])`).waitFor()
	const preview = await page.locator(`.snap-preview`).boundingBox()
	await page.screenshot({ path: resolve(artifacts, `snap-preview.png`) })
	await page.mouse.up()
	assert.deepEqual(await panel.boundingBox(), preview)
	await page
		.getByRole(`button`, { name: `Debugger layout`, exact: true })
		.click()
	await page.getByRole(`button`, { name: `Restore free position` }).click()
	// Keyboard controls and viewport contraction never strand the window.
	await move.focus()
	await page.keyboard.press(`ArrowLeft`)
	assert.equal((await panel.boundingBox()).x, free.x - 10)
	await page.getByRole(`button`, { name: `Resize debugger left edge` }).focus()
	await page.keyboard.press(`ArrowRight`)
	assert.equal((await panel.boundingBox()).width, free.width - 10)
	await page.setViewportSize({ width: 200, height: 100 })
	assert.deepEqual(await panel.boundingBox(), {
		x: 0,
		y: 0,
		width: 200,
		height: 100,
	})
	await page.getByTestId(`open-close-devtools`).click()
	await page.getByTestId(`open-close-devtools`).click()
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.evaluate(() => {
		localStorage.removeItem(`🔍 Devtools Window`)
		window.devtoolsWindowTest.remount()
	})
	// Repeated real capture, pointer cancellation and remount flows.
	for (let cycle = 0; cycle < 5; cycle++) {
		handle = await move.boundingBox()
		await page.mouse.move(handle.x + 7, handle.y + 10)
		await page.mouse.down()
		await page.mouse.move(handle.x - 50, handle.y + 40)
		await page.evaluate(() => {
			const toolbar = document.querySelector(`.toolbar`)
			toolbar.dispatchEvent(
				new PointerEvent(`pointercancel`, { pointerId: 1, bubbles: true }),
			)
		})
		await page.mouse.up()
		await page.evaluate(() => {
			window.devtoolsWindowTest.remount()
		})
		assert.equal(await panel.count(), 1)
		assert.equal(await page.locator(`.snap-palette:visible`).count(), 0)
	}
	// A frame-paced synthetic stream in real Chromium; double-rAF is a paint-boundary proxy, not hardware latency.
	handle = await move.boundingBox()
	await page.mouse.move(handle.x + 7, handle.y + 10)
	await page.mouse.down()
	const metrics = await page.evaluate(async () => {
		const toolbar = document.querySelector(`.toolbar`)
		const start = performance.now(),
			samples = [],
			frames = [],
			longTasks = []
		const observer = new PerformanceObserver((list) => {
			longTasks.push(...list.getEntries().map((entry) => entry.duration))
		})
		observer.observe({ type: `longtask`, buffered: false })
		for (let index = 0; index < 300; index++) {
			await new Promise(requestAnimationFrame)
			const time = performance.now()
			frames.push(time)
			toolbar.dispatchEvent(
				new PointerEvent(`pointermove`, {
					pointerId: 1,
					clientX: 700 + (index % 100),
					clientY: 180 + (index % 40),
					bubbles: true,
				}),
			)
			requestAnimationFrame(() =>
				requestAnimationFrame(() => samples.push(performance.now() - time)),
			)
		}
		await new Promise(requestAnimationFrame)
		await new Promise(requestAnimationFrame)
		observer.disconnect()
		samples.sort((a, b) => a - b)
		return {
			durationMs: performance.now() - start,
			frames: frames.length,
			averageFrameMs: (frames.at(-1) - frames[0]) / 299,
			p95PaintBoundaryMs: samples[Math.ceil(samples.length * 0.95) - 1],
			sampleCount: samples.length,
			longTasksOver50Ms: longTasks.filter((duration) => duration > 50),
			graphCodePresent: false,
		}
	})
	await page.keyboard.press(`Escape`)
	await page.mouse.up()
	await page.screenshot({ path: resolve(artifacts, `window.png`) })
	await context.tracing.stop({ path: resolve(artifacts, `trace.zip`) })
	assert.deepEqual(errors, [])
	const report = {
		candidate: process.env.SPA_DEVTOOLS_CANDIDATE_SHA ?? `working-tree`,
		browser: browser.version(),
		machine: `${platform()}/${arch()} ${cpus()[0]?.model}`,
		viewport: { width: 1440, height: 900 },
		method: `300 rAF-paced synthetic pointermoves during real pointer capture; dispatch to double-rAF paint-boundary proxy; all long tasks counted conservatively; graph code absent in S2`,
		...metrics,
	}
	await writeFile(
		resolve(artifacts, `metrics.json`),
		JSON.stringify(report, null, 2),
	)
	console.log(JSON.stringify(report, null, 2))
	assert.ok(
		metrics.p95PaintBoundaryMs <= 33,
		`Paint-boundary proxy p95 exceeded proposed 33ms target`,
	)
	assert.equal(metrics.longTasksOver50Ms.length, 0)
	await context.close()
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
