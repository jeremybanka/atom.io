import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { arch, cpus, platform } from "node:os"
import { resolve } from "node:path"

import { build } from "esbuild"
import type { Browser } from "playwright"

import {
	browserArtifacts,
	cpuRate,
	launchBrowser,
	loadDevtoolsAssets,
} from "./browser-runtime.ts"
import type { FrameSample } from "./fixtures/window-browser/timing.ts"

const artifacts = browserArtifacts(
	process.env[`SPA_DEVTOOLS_BROWSER_ARTIFACTS`] ?? `/tmp/devtools-window`,
)
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
const assets = await loadDevtoolsAssets()
const server = createServer((req, res) => {
	const pathname = new URL(req.url ?? `/`, `http://localhost`).pathname
	const asset = assets.get(pathname)
	if (asset) {
		res.setHeader(`content-type`, asset.type)
		res.end(asset.body)
		return
	}

	res.setHeader(
		`content-type`,
		req.url === `/app.js` ? `application/javascript` : `text/html`,
	)
	res.end(
		req.url === `/app.js`
			? bundle.outputFiles[0].text
			: `<link rel="stylesheet" href="/devtools.css"><script type="module" src="/app.js"></script>`,
	)
})
await new Promise<void>((ready) => server.listen(0, `127.0.0.1`, ready))
let browser: Browser | undefined
try {
	browser = await launchBrowser()
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	})
	await context.tracing.start({ screenshots: false, snapshots: true })
	const page = await context.newPage()
	const errors: string[] = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
	const panel = page.locator(`debugger-panel[data-css="devtools"]`)
	const move = page.getByRole(`button`, { name: `Move debugger`, exact: true })
	await page.getByRole(`tab`, { name: `atoms`, exact: true }).click()
	const input = page.getByRole(`textbox`, { name: `count`, exact: true })
	await input.fill(`2.`)
	await input.evaluate((node: HTMLElement) => {
		window.retainedInput = node
	})
	assert.equal(await page.evaluate(() => window.devtoolsWindowTest.value()), 2)
	const free = await panel.boundingBox()
	if (!free) throw new Error(`Missing free`)
	// Real captured pointer drag, then Escape: original rectangle and input identity survive.
	let handle = await move.boundingBox()
	assert.ok(handle)
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
			(node: HTMLInputElement) =>
				node === window.retainedInput && node.value === `2.`,
		),
		true,
	)
	// Physical edge/corner resizing, each followed by cancellation.
	for (const edge of [`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`]) {
		const box = await page.locator(`[data-resize="${edge}"]`).boundingBox()
		if (!box) throw new Error(`Missing box`)
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
		[`Left two-thirds`, 0, 0, 960, 900],
		[`Center third`, 480, 0, 480, 900],
		[`Right two-thirds`, 480, 0, 960, 900],
		[`Right third`, 960, 0, 480, 900],
		[`Top half`, 0, 0, 1440, 450],
		[`Bottom half`, 0, 450, 1440, 450],
		[`Full viewport`, 0, 0, 1440, 900],
	] as const
	for (const [label, x, y, width, height] of targets) {
		await page
			.getByRole(`button`, { name: `Debugger layout`, exact: true })
			.click()
		assert.equal(
			await page
				.getByRole(`button`, { name: `Left half`, exact: true })
				.evaluate((node) => node === document.activeElement),
			true,
		)
		const option = page.getByRole(`button`, { name: label, exact: true })
		assert.equal(await option.textContent(), ``)
		assert.deepEqual(
			await option
				.locator(`svg rect[fill="currentColor"]`)
				.evaluate((tile) =>
					[`x`, `y`, `width`, `height`].map((attribute) =>
						Number(tile.getAttribute(attribute)),
					),
				),
			[
				2 + (x * 24) / 1440,
				2 + (y * 16) / 900,
				(width * 24) / 1440,
				(height * 16) / 900,
			],
		)
		await option.click()
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
	assert.ok(handle)
	await page.mouse.move(handle.x + 7, handle.y + 10)
	await page.mouse.down()
	await page.mouse.move(handle.x - 10, handle.y + 10)
	await page.locator(`snap-palette`).waitFor({ state: `visible` })
	const target = await page
		.getByRole(`button`, { name: `Right third`, exact: true })
		.boundingBox()
	if (!target) throw new Error(`Missing target`)
	await page.mouse.move(
		target.x + target.width / 2,
		target.y + target.height / 2,
		{ steps: 12 },
	)
	await page.locator(`snap-preview:not([hidden])`).waitFor()
	const preview = await page.locator(`snap-preview`).boundingBox()
	await page.screenshot({ path: resolve(artifacts, `snap-preview.png`) })
	await page.mouse.up()
	assert.deepEqual(await panel.boundingBox(), preview)
	await page
		.getByRole(`button`, { name: `Debugger layout`, exact: true })
		.click()
	await page.getByRole(`button`, { name: `Restore free position` }).click()
	// Slide along the bottom edge into the two-thirds zones, then drop.
	for (const [pointerX, x] of [
		[480, 0],
		[960, 480],
	]) {
		handle = await move.boundingBox()
		assert.ok(handle)
		await page.mouse.move(handle.x + 7, handle.y + 10)
		await page.mouse.down()
		await page.mouse.move(720, 899, { steps: 6 })
		await page.mouse.move(pointerX, 899, { steps: 6 })
		await page.waitForFunction((left) => {
			const rect = document
				.querySelector(`snap-preview:not([hidden])`)
				?.getBoundingClientRect()
			return (
				rect?.x === left &&
				rect.y === 0 &&
				rect.width === 960 &&
				rect.height === 900
			)
		}, x)
		await page.mouse.up()
		assert.deepEqual(await panel.boundingBox(), {
			x,
			y: 0,
			width: 960,
			height: 900,
		})
		await page
			.getByRole(`button`, { name: `Debugger layout`, exact: true })
			.click()
		await page.getByRole(`button`, { name: `Restore free position` }).click()
		assert.deepEqual(await panel.boundingBox(), free)
	}
	// The collapsed logo moves independently and a drag never activates Open.
	await page
		.getByRole(`button`, { name: `Minimize debugger`, exact: true })
		.click()
	const launcher = page.getByRole(`button`, {
		name: `Open debugger`,
		exact: true,
	})
	await launcher.hover()
	const launcherAppearance = await launcher.evaluate((button) => {
		const root = button.closest(`debugger-panel`)!
		return {
			backgrounds: [root, button.parentElement!, button].map(
				(node) => getComputedStyle(node).backgroundColor,
			),
			border: getComputedStyle(root).borderTopWidth,
			noise: getComputedStyle(root, `::before`).display,
			resizeHandles: [...root.querySelectorAll(`[data-resize]`)].some(
				(node) => getComputedStyle(node).display !== `none`,
			),
		}
	})
	assert.deepEqual(
		launcherAppearance.backgrounds,
		Array(3).fill(`rgba(0, 0, 0, 0)`),
	)
	assert.equal(launcherAppearance.border, `0px`)
	assert.equal(launcherAppearance.noise, `none`)
	assert.equal(launcherAppearance.resizeHandles, false)
	const mini = await panel.boundingBox()
	assert.ok(mini)
	assert.equal(mini.width, 32)
	assert.equal(mini.height, 32)
	await page.mouse.move(mini.x + 16, mini.y + 16)
	await page.mouse.down()
	await page.mouse.move(1436, 896, { steps: 12 })
	await page.mouse.up()
	assert.equal(
		await panel.getAttribute(`data-open`),
		`false`,
		`Drag must not activate Open`,
	)
	const movedLauncher = { x: 1408, y: 868, width: 32, height: 32 }
	assert.deepEqual(await panel.boundingBox(), movedLauncher)
	assert.equal(await page.locator(`snap-palette:visible`).count(), 0)
	await page.evaluate(() => {
		window.devtoolsWindowTest.remount()
	})
	assert.deepEqual(await panel.boundingBox(), movedLauncher)
	await page.mouse.move(1424, 884)
	await page.mouse.down()
	await page.mouse.move(1300, 760, { steps: 4 })
	await page.keyboard.press(`Escape`)
	await page.mouse.up()
	assert.deepEqual(await panel.boundingBox(), movedLauncher)
	assert.equal(await panel.getAttribute(`data-open`), `false`)
	await launcher.focus()
	await page.keyboard.press(`ArrowLeft`)
	assert.deepEqual(await panel.boundingBox(), { ...movedLauncher, x: 1398 })
	await page.keyboard.press(`Enter`)
	assert.deepEqual(
		await panel.boundingBox(),
		free,
		`Opening restores the expanded window`,
	)
	await page
		.getByRole(`button`, { name: `Minimize debugger`, exact: true })
		.click()
	assert.deepEqual(await panel.boundingBox(), { ...movedLauncher, x: 1398 })
	await launcher.click()
	assert.deepEqual(await panel.boundingBox(), free)
	// Keyboard controls and viewport contraction never strand the expanded window.
	await move.focus()
	await page.keyboard.press(`ArrowLeft`)
	assert.equal((await panel.boundingBox())!.x, free.x - 10)
	await page.getByRole(`button`, { name: `Resize debugger left edge` }).focus()
	await page.keyboard.press(`ArrowRight`)
	assert.equal((await panel.boundingBox())!.width, free.width - 10)
	const beforeNarrow = await page.evaluate(() =>
		window.devtoolsWindowTest.resizeRevision(),
	)
	await page.setViewportSize({ width: 200, height: 100 })
	await page.waitForFunction((revision) => {
		const box = document
			.querySelector<HTMLElement>(`debugger-panel[data-css="devtools"]`)!
			.getBoundingClientRect()
		if (!box) throw new Error(`Missing box`)
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
		assert.ok(handle)
		await page.mouse.move(handle.x + 7, handle.y + 10)
		await page.mouse.down()
		await page.mouse.move(handle.x - 50, handle.y + 40)
		await page.evaluate(() => {
			const toolbar = document.querySelector<HTMLElement>(`debugger-toolbar`)!
			toolbar.dispatchEvent(
				new PointerEvent(`pointercancel`, { pointerId: 1, bubbles: true }),
			)
		})
		await page.mouse.up()
		await page.evaluate(() => {
			window.devtoolsWindowTest.remount()
		})
		assert.equal(await panel.count(), 1)
		assert.equal(await page.locator(`snap-palette:visible`).count(), 0)
	}
	// Each sample dispatches from a fresh task and observes geometry in the first frame after the handler.
	// A later frame is recorded separately as a clock proxy, never asserted as painted-input latency.
	handle = await move.boundingBox()
	assert.ok(handle)
	const timingBase = await panel.boundingBox()
	assert.ok(timingBase)
	const pressPoint = { x: handle.x + 7, y: handle.y + 10 }
	await page.mouse.move(pressPoint.x, pressPoint.y)
	await page.mouse.down()
	let deadline: ReturnType<typeof setTimeout> | undefined
	const metrics = await Promise.race([
		page.evaluate(
			async ({ base, startPoint }) => {
				const baseline = [],
					controller = [],
					longTasks: { startTime: number; duration: number }[] = []
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
					const matches = ([`x`, `y`, `width`, `height`] as const).every(
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
					ecologyViewAvailable: !!document.querySelector<HTMLElement>(
						`[data-testid="view-ecology"]`,
					)!,
				}
			},
			{ base: timingBase, startPoint: pressPoint },
		),
		new Promise<never>((_, reject) => {
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
	const summarize = (samples: FrameSample[]) =>
		Object.fromEntries(
			(
				[
					`dispatchMs`,
					`handlerToFrameMs`,
					`dispatchToFrameMs`,
					`nextFrameProxyMs`,
				] as const
			).map((key) => {
				const values = samples
					.map((sample) => {
						const value = sample[key]
						assert.ok(
							typeof value === `number` && Number.isFinite(value),
							`Incomplete timing samples for ${key}`,
						)
						return value
					})
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
		cpuRate,
		candidate: process.env[`SPA_DEVTOOLS_CANDIDATE_SHA`] ?? `working-tree`,
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
			controllerSummary[`dispatchToFrameMs`].p95 -
			baselineSummary[`dispatchToFrameMs`].p95,
		...metrics,
	}
	await writeFile(
		resolve(artifacts, `metrics.json`),
		JSON.stringify(report, null, 2),
	)
	process.stdout.write(
		JSON.stringify(
			{
				...report,
				baseline: `${metrics.baseline.length} raw samples saved in metrics.json`,
				controller: `${metrics.controller.length} raw samples saved in metrics.json`,
			},
			null,
			2,
		) + `\n`,
	)
	assert.equal(metrics.longTasksOver50Ms.length, 0)
	await context.close()
} finally {
	await browser?.close()
	await new Promise<void>((done) =>
		server.close(() => {
			done()
		}),
	)
}
