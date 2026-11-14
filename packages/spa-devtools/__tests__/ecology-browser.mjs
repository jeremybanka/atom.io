import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { arch, cpus, platform } from "node:os"
import { resolve as resolvePath } from "node:path"

import { build } from "esbuild"
import { chromium } from "playwright"

const artifacts =
	process.env.SPA_DEVTOOLS_ECOLOGY_ARTIFACTS ?? `/tmp/spa-devtools-ecology`
await mkdir(artifacts, { recursive: true })
const bundle = await build({
	entryPoints: [
		resolvePath(import.meta.dirname, `fixtures/ecology-browser/main.ts`),
	],
	bundle: true,
	write: false,
	tsconfigRaw: {},
	format: `esm`,
	platform: `browser`,
	define: { "import.meta.env.DEV": `false` },
})
const css = await readFile(
	resolvePath(import.meta.dirname, `../dist/devtools.css`),
	`utf8`,
)
const server = createServer((request, response) => {
	response.setHeader(
		`content-type`,
		request.url === `/app.js` ? `application/javascript` : `text/html`,
	)
	response.end(
		request.url === `/app.js`
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
		colorScheme: `dark`,
	})
	await context.tracing.start({ screenshots: true, snapshots: true })
	const page = await context.newPage(),
		errors = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	await page.goto(`http://127.0.0.1:${server.address().port}`)
	const ready = async () => {
		await page.waitForFunction(
			() => document.querySelector(`.ecology`)?.dataset.ready === `true`,
		)
	}
	const choose = async (id) => {
		await page.locator(`g[data-graph-id]`).evaluateAll((nodes, target) => {
			const node = nodes.find((item) => item.dataset.graphId === target)
			assertPresent(node)
			node.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
			function assertPresent(value) {
				if (!value) throw new Error(`Missing graph node ${target}`)
			}
		}, id)
	}
	await ready()
	const before = await page.evaluate(() => window.ecologyFixture.evidence())
	await page.getByRole(`textbox`, { name: `Search ecology` }).fill(`dormant`)
	await ready()
	await page.getByText(`Accessible node list`, { exact: true }).click()
	await page.locator(`.ecology-list button`).first().focus()
	await page.keyboard.press(`Enter`)
	assert.match(await page.locator(`.ecology-inspector`).innerText(), /dormant/)
	await page
		.getByRole(`button`, { name: `Trace observed roots`, exact: true })
		.focus()
	await page.keyboard.press(`Enter`)
	await ready()
	assert.equal(
		await page.evaluate(() => document.activeElement.textContent),
		`Trace observed roots`,
	)
	await page.getByText(`Accessible node list`, { exact: true }).click()
	assert.match(
		await page.locator(`.ecology-inspector`).innerText(),
		/incomplete/,
	)
	await page.getByRole(`textbox`, { name: `Search ecology` }).fill(``)
	await ready()
	await choose(`family:items`)
	await page.getByRole(`button`, { name: `Expand family`, exact: true }).click()
	await ready()
	await page
		.getByRole(`button`, { name: `Collapse family`, exact: true })
		.click()
	await ready()
	const after = await page.evaluate(() => window.ecologyFixture.evidence())
	assert.deepEqual(
		{
			reads: after.reads,
			cache: after.cache,
			graph: after.graph,
			members: after.members,
		},
		{
			reads: before.reads,
			cache: before.cache,
			graph: before.graph,
			members: before.members,
		},
	)
	assert.equal(after.reads, 0)
	await choose(`state:total`)
	await page
		.getByRole(`button`, { name: `Trace observed roots`, exact: true })
		.click()
	await ready()
	assert.match(await page.locator(`.ecology-inspector`).innerText(), /price/)
	await page.screenshot({ path: resolvePath(artifacts, `small-traced.png`) })
	const positions = await page
		.locator(`g[data-graph-id]`)
		.evaluateAll((nodes) =>
			nodes.map((node) => [
				node.dataset.graphId,
				node.getAttribute(`transform`),
			]),
		)
	await page.evaluate(() => {
		window.ecologyFixture.change()
	})
	await page.getByRole(`button`, { name: `Refresh`, exact: true }).click()
	await ready()
	assert.deepEqual(
		await page
			.locator(`g[data-graph-id]`)
			.evaluateAll((nodes) =>
				nodes.map((node) => [
					node.dataset.graphId,
					node.getAttribute(`transform`),
				]),
			),
		positions,
	)
	assert.equal(
		await page.locator(`.ecology`).getAttribute(`data-new-positions`),
		`0`,
	)
	const jobs = await page.locator(`.ecology`).getAttribute(`data-jobs`)
	await page
		.getByRole(`button`, { name: `Debugger layout`, exact: true })
		.click()
	await page
		.getByRole(`button`, { name: `Restore free position`, exact: true })
		.click()
	const beforeGeometry = await page
		.locator(`main[data-css="spa-devtools"]`)
		.boundingBox()
	await page.getByRole(`button`, { name: `Move debugger`, exact: true }).focus()
	await page.keyboard.press(`ArrowLeft`)
	assert.equal(
		(await page.locator(`main[data-css="spa-devtools"]`).boundingBox()).x,
		beforeGeometry.x - 10,
	)
	assert.equal(await page.locator(`.ecology`).getAttribute(`data-jobs`), jobs)
	await choose(`state:dormant`)
	await page
		.getByRole(`button`, {
			name: `Open live editor (may read/evaluate)`,
			exact: true,
		})
		.click()
	assert.equal(
		await page.evaluate(() => window.ecologyFixture.timings().reads),
		1,
	)
	await page
		.getByRole(`button`, { name: `Back to passive inspector`, exact: true })
		.click()
	await page
		.getByRole(`button`, { name: `Minimize debugger`, exact: true })
		.click()
	assert.equal(await page.locator(`.ecology`).count(), 0)
	await page.getByRole(`button`, { name: `Open debugger`, exact: true }).click()
	await ready()
	await page.setViewportSize({ width: 390, height: 844 })
	await page.screenshot({ path: resolvePath(artifacts, `narrow.png`) })
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.evaluate(() => {
		window.ecologyFixture.mount(`empty`)
	})
	await ready()
	await page.screenshot({ path: resolvePath(artifacts, `empty.png`) })
	assert.match(
		await page.locator(`.ecology-counts`).innerText(),
		/0 atoms · 0 selectors/,
	)
	const cdp = await context.newCDPSession(page)
	await cdp.send(`Tracing.start`, {
		categories: `devtools.timeline,blink.user_timing`,
		transferMode: `ReturnAsStream`,
	})
	await page.evaluate(() => {
		performance.mark(`s4-overview-start`)
		window.ecologyFixture.mount(`large`)
	})
	await ready()
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => {
					performance.mark(`s4-overview-observed`)
					resolve()
				}),
			),
	)
	const overview = await page.evaluate(() => ({
		overviewMs: performance.now() - window.ecologyFixture.timings().mountStarted,
		setupMs: window.ecologyFixture.timings().setupMs,
		...document.querySelector(`.ecology`).dataset,
		counts: document.querySelector(`.ecology-counts`).textContent,
		notice: document.querySelector(`.ecology-notice`).textContent,
	}))
	assert.equal(await page.locator(`g[data-graph-id]`).count(), 500)
	assert.equal(await page.locator(`.ecology-edge`).count(), 1_000)
	await page.screenshot({ path: resolvePath(artifacts, `large.png`) })
	await page.evaluate(() => performance.mark(`s4-overview-end`))
	const search = [],
		selection = []
	for (let index = 0; index < 20; index++) {
		const sample = await page.evaluate(
			async (key) => {
				const input = document.querySelector(`[aria-label="Search ecology"]`)
				const start = performance.now()
				input.value = key
				input.dispatchEvent(new Event(`input`, { bubbles: true }))
				await new Promise((resolve) => {
					const check = () => {
						if (document.querySelector(`.ecology`).dataset.ready === `true`)
							resolve()
						else setTimeout(check, 0)
					}
					check()
				})
				await new Promise(requestAnimationFrame)
				const searched = performance.now()
				document
					.querySelector(`g[data-graph-id]`)
					.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
				await new Promise(requestAnimationFrame)
				return {
					search: searched - start,
					selection: performance.now() - searched,
				}
			},
			index % 5 === 0
				? ``
				: index % 5 === 1
					? `batch0`
					: `derived${index + 100}`,
		)
		search.push(sample.search)
		selection.push(sample.selection)
	}
	assert.equal(
		await page.evaluate(() => window.ecologyFixture.timings().reads),
		0,
	)
	const stopped = new Promise((resolve) =>
		cdp.once(`Tracing.tracingComplete`, resolve),
	)
	await cdp.send(`Tracing.end`)
	const { stream } = await stopped
	let trace = ``
	for (;;) {
		const chunk = await cdp.send(`IO.read`, { handle: stream })
		trace += chunk.data
		if (chunk.eof) break
	}
	await cdp.send(`IO.close`, { handle: stream })
	await writeFile(resolvePath(artifacts, `renderer-trace.json`), trace)
	const events = JSON.parse(trace).traceEvents
	const startMark = events.find((event) => event.name === `s4-overview-start`),
		endMark = events.find((event) => event.name === `s4-overview-end`)
	const paints = events.filter(
		(event) =>
			event.name === `Paint` &&
			event.ts >= startMark.ts &&
			event.ts <= endMark.ts,
	)
	const p95 = (values) =>
		[...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
	const report = {
		candidate: process.env.SPA_DEVTOOLS_CANDIDATE_SHA ?? `working-tree`,
		browser: browser.version(),
		machine: `${platform()}/${arch()} ${cpus()[0]?.model}`,
		viewport: { width: 1440, height: 900 },
		fixture: { instances: 10_000, observedEdges: 30_000 },
		overview,
		rendererPaintMs:
			paints.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1_000,
		paintRecords: paints.length,
		searchMs: search,
		selectionMs: selection,
		searchP95Ms: p95(search),
		selectionP95Ms: p95(selection),
		proposedTargets: {
			overviewMs: 500,
			interactionP95Ms: 100,
			layoutChunkMs: 8,
		},
		method: `Fresh-task DOM search/selection with first-frame observations, not hardware/compositor input latency. Snapshot, scheduled projection/layout slices, DOM commit and renderer Paint records reported separately. Large fixture construction excluded from overview and reported as setupMs. S3 capture limits may truncate observations; notice/counts retained.`,
	}
	await writeFile(
		resolvePath(artifacts, `metrics.json`),
		JSON.stringify(report, null, 2),
	)
	console.log(JSON.stringify(report, null, 2))
	assert.deepEqual(errors, [])
	assert.ok(
		Number(overview.maxChunkMs) <= 8,
		`Layout chunk ${overview.maxChunkMs}ms exceeds8ms`,
	)
	assert.ok(
		overview.overviewMs <= 500,
		`Overview ${overview.overviewMs}ms exceeds500ms`,
	)
	assert.ok(
		report.searchP95Ms <= 100 && report.selectionP95Ms <= 100,
		`Interaction p95 exceeds100ms`,
	)
	await context.tracing.stop({ path: resolvePath(artifacts, `trace.zip`) })
	await context.close()
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
