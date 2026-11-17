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
	const beforeNarrow = await page.evaluate(() =>
		window.devtoolsWindowTest.resizeRevision(),
	)
	await page.setViewportSize({ width: 200, height: 100 })
	await page.waitForFunction((revision) => {
		const box = document
			.querySelector(`main[data-css="spa-devtools"]`)
			.getBoundingClientRect()
		return (
			window.devtoolsWindowTest.resizeRevision() > revision &&
			box.x === 0 &&
			box.y === 0 &&
			box.width === 200 &&
			box.height === 100
		)
	}, beforeNarrow)
	assert.deepEqual(await panel.boundingBox(), {
		x: 0,
		y: 0,
		width: 200,
		height: 100,
	})
	await page.getByTestId(`open-close-devtools`).click()
	await page.getByTestId(`open-close-devtools`).click()
	const beforeWide = await page.evaluate(() =>
		window.devtoolsWindowTest.resizeRevision(),
	)
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.waitForFunction(
		(revision) => window.devtoolsWindowTest.resizeRevision() > revision,
		beforeWide,
	)
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
	// Each sample dispatches from a fresh task and observes geometry in the first frame after the handler.
	// A later frame is recorded separately as a clock proxy, never asserted as painted-input latency.
	handle = await move.boundingBox()
	const timingBase = await panel.boundingBox()
	const pressPoint = { x: handle.x + 7, y: handle.y + 10 }
	await page.mouse.move(pressPoint.x, pressPoint.y)
	await page.mouse.down()
	let deadline
	const metrics = await Promise.race([
		page.evaluate(
			async ({ base, startPoint }) => {
				const baseline = [],
					controller = [],
					longTasks = []
				const observer = new PerformanceObserver((list) => {
					longTasks.push(
						...list
							.getEntries()
							.map(({ startTime, duration }) => ({ startTime, duration })),
					)
				})
				observer.observe({ type: `longtask`, buffered: false })
				const baselineStart = performance.now()
				for (let index = 0; index < 60; index++) {
					const sample = await window.devtoolsWindowTest.sample(true, 0, 0)
					if (JSON.stringify(sample.before) !== JSON.stringify(sample.observed))
						throw new Error(`No-op baseline changed geometry`)
					baseline.push(sample)
				}
				const baselineDurationMs = performance.now() - baselineStart
				const start = performance.now()
				for (let index = 0; index < 300; index++) {
					const x = 700 + (index % 100),
						y = 180 + (index % 40)
					const sample = await window.devtoolsWindowTest.sample(false, x, y)
					const expected = {
						...base,
						x: Math.max(
							0,
							Math.min(base.x + x - startPoint.x, innerWidth - base.width),
						),
						y: Math.max(
							0,
							Math.min(base.y + y - startPoint.y, innerHeight - base.height),
						),
					}
					// Checking the latest expected rectangle detects a one-frame-late update, not just any style mutation.
					const matches = Object.keys(expected).every(
						(key) => Math.abs(sample.observed[key] - expected[key]) < 0.01,
					)
					if (!matches)
						throw new Error(
							`Geometry missed its first frame observation: ${JSON.stringify({ expected, observed: sample.observed })}`,
						)
					controller.push(sample)
				}
				const durationMs = performance.now() - start
				await new Promise(requestAnimationFrame)
				await new Promise(requestAnimationFrame)
				observer.disconnect()
				return {
					baselineDurationMs,
					durationMs,
					observedSamplesPerSecond: (controller.length * 1000) / durationMs,
					baseline,
					controller,
					longTasksOver50Ms: longTasks.filter(({ duration }) => duration > 50),
					ecologyViewAvailable: !!document.querySelector(
						`[data-testid="view-ecology"]`,
					),
				}
			},
			{ base: timingBase, startPoint: pressPoint },
		),
		new Promise((_, reject) => {
			deadline = setTimeout(() => {
				reject(new Error(`Timing capture exceeded 30 seconds`))
			}, 30_000)
		}),
	]).finally(() => {
		clearTimeout(deadline)
	})
	await page.keyboard.press(`Escape`)
	await page.mouse.up()
	await page.screenshot({ path: resolve(artifacts, `window.png`) })
	await context.tracing.stop({ path: resolve(artifacts, `trace.zip`) })
	assert.deepEqual(errors, [])
	const summarize = (samples) =>
		Object.fromEntries(
			[
				`dispatchMs`,
				`handlerToFrameMs`,
				`dispatchToFrameMs`,
				`nextFrameProxyMs`,
			].map((key) => {
				const values = samples
					.map((sample) => sample[key])
					.sort((left, right) => left - right)
				assert.ok(
					values.every((value) => Number.isFinite(value)),
					`Incomplete timing samples for ${key}`,
				)
				return [
					key,
					{
						p50: values[Math.ceil(values.length * 0.5) - 1],
						p95: values[Math.ceil(values.length * 0.95) - 1],
						max: values.at(-1),
					},
				]
			}),
		)
	const baselineSummary = summarize(metrics.baseline),
		controllerSummary = summarize(metrics.controller)
	const report = {
		candidate: process.env.SPA_DEVTOOLS_CANDIDATE_SHA ?? `working-tree`,
		browser: browser.version(),
		machine: `${platform()}/${arch()} ${cpus()[0]?.model}`,
		viewport: { width: 1440, height: 900 },
		method: `Fresh-task synthetic dispatch during real pointer capture; 60 no-op control samples then 300 controller samples. Separate synchronous dispatch span, handler-to-first-frame scheduling, observed geometry and later-frame clock proxy. No compositor/hardware input-to-paint latency measurement. All long tasks counted conservatively.`,
		paintLatencyTarget: {
			proposedMs: 33,
			verdict: `not measured; requires presentation/trace analysis`,
		},
		baselineSummary,
		controllerSummary,
		p95FrameObservationDeltaMs:
			controllerSummary.dispatchToFrameMs.p95 -
			baselineSummary.dispatchToFrameMs.p95,
		...metrics,
	}
	await writeFile(
		resolve(artifacts, `metrics.json`),
		JSON.stringify(report, null, 2),
	)
	console.log(
		JSON.stringify(
			{
				...report,
				baseline: `${metrics.baseline.length} raw samples saved in metrics.json`,
				controller: `${metrics.controller.length} raw samples saved in metrics.json`,
			},
			null,
			2,
		),
	)
	assert.equal(metrics.longTasksOver50Ms.length, 0)
	await context.close()
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
