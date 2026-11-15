import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { arch, cpus, platform } from "node:os"
import { resolve as resolvePath } from "node:path"

import { build } from "esbuild"
import { browserArtifacts, cpuRate, launchBrowser } from "./browser-runtime.mjs"

const artifacts = browserArtifacts(
	process.env.SPA_DEVTOOLS_SEARCH_ARTIFACTS ?? `/tmp/spa-devtools-search`,
)
await mkdir(artifacts, { recursive: true })
const bundle = await build({
	entryPoints: [
		resolvePath(import.meta.dirname, `fixtures/search-browser/main.ts`),
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
const report = {
	cpuRate,
	candidate:
		process.env.SPA_DEVTOOLS_CANDIDATE_SHA ??
		process.env.GITHUB_SHA ??
		`uncommitted`,
	ci: {
		testedRevision: process.env.GITHUB_SHA ?? null,
		pullRequestHead: process.env.SPA_DEVTOOLS_PR_HEAD_SHA ?? null,
	},
	sandbox: true,
	machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
	stage: `functional profiles`,
	profiles: [],
	scale: {},
}
try {
	browser = await launchBrowser()
	report.browser = browser.version()
	for (const width of [1440, 390])
		for (const colorScheme of [`light`, `dark`]) {
			const page = await browser.newPage({
				viewport: { width, height: 900 },
				colorScheme,
			})
			page.setDefaultTimeout(5_000)

			const errors = []
			page.on(`pageerror`, (error) => errors.push(error.message))
			await page.goto(`http://127.0.0.1:${server.address().port}`)
			const ready = () =>
				page.waitForFunction(
					() =>
						document.querySelector(`.state-search`)?.dataset.ready === `true`,
				)
			await ready()
			const search = page.getByRole(`searchbox`, { name: `Search atoms` })
			const editor = page.locator(`[data-testid="state-value-count"] input`)
			await editor.fill(`1e`)
			await editor.evaluate((input) => input.setSelectionRange(1, 2))
			await search.fill(`not-found`)
			await ready()
			assert.equal(await editor.inputValue(), `1e`)
			assert.equal(await editor.isVisible(), true)
			await page.getByRole(`button`, { name: `Refresh`, exact: true }).click()
			await ready()
			assert.equal(await editor.inputValue(), `1e`)
			await search.press(`Escape`)
			await ready()
			await search.press(`Escape`)
			assert.equal(
				await editor.evaluate(
					(input) =>
						input === document.activeElement &&
						input.selectionStart === 1 &&
						input.selectionEnd === 2,
				),
				true,
			)
			await page
				.getByRole(`button`, { name: `Expand record`, exact: true })
				.click()
			const rename = page.getByRole(`textbox`, { name: `Rename a`, exact: true })

			await rename.fill(`renamed`)
			await search.fill(`count`)
			await ready()
			await page.locator(`[data-search-id="state:count"]`).click()
			assert.equal(await rename.inputValue(), `renamed`)
			await search.focus()
			await search.press(`Escape`)
			await ready()
			await search.press(`Escape`)
			assert.equal(
				await rename.evaluate((input) => document.activeElement === input),
				true,
			)
			await rename.press(`Enter`)
			assert.equal(
				await page
					.getByRole(`textbox`, { name: `Rename renamed`, exact: true })
					.count(),
				1,
			)
			await search.fill(`items`)
			await ready()
			const before = await page.evaluate(() => window.searchFixture.evidence())
			await page.locator(`[data-search-id='state:items("dormant")']`).click()
			assert.deepEqual(
				await page.evaluate(() => window.searchFixture.evidence()),
				before,
			)
			await search.focus()
			await search.press(`ArrowDown`)
			await page.keyboard.press(`End`)
			await page.keyboard.press(`Enter`)
			await page.keyboard.press(`Escape`)
			assert.equal(
				await search.evaluate((input) => input === document.activeElement),
				true,
			)
			await search.fill(`fulfilled`)
			await ready()
			assert.match(
				await page.locator(`.search-results`).innerText(),
				/cached value/,
			)
			const panelRect = await page.locator(`main`).boundingBox()
			const handle = await page
				.getByRole(`button`, { name: `Move debugger`, exact: true })
				.boundingBox()
			await page.mouse.move(
				handle.x + handle.width / 2,
				handle.y + handle.height / 2,
			)
			await page.mouse.down()
			await page.mouse.move(handle.x + 60, handle.y + 45)
			await search.focus()
			await search.press(`Escape`)
			await page.mouse.up()
			assert.equal(await search.inputValue(), `fulfilled`)
			assert.deepEqual(await page.locator(`main`).boundingBox(), panelRect)
			assert.equal(
				await page.locator(`main`).getAttribute(`data-window-interaction`),
				`false`,
			)

			await page.screenshot({
				path: `${artifacts}/search-${width}-${colorScheme}.png`,
				fullPage: true,
			})
			assert.equal(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
				true,
			)
			assert.deepEqual(errors, [])
			report.profiles.push({
				width,
				colorScheme,
				draft: true,
				rename: true,
				passive: true,
				keyboard: true,
				screenshot: `search-${width}-${colorScheme}.png`,
			})
			await page.close()
		}
	const zoom = await browser.newPage({ viewport: { width: 195, height: 450 } })
	await zoom.goto(`http://127.0.0.1:${server.address().port}`)
	await zoom.waitForFunction(
		() => document.querySelector(`.state-search`)?.dataset.ready === `true`,
	)
	await zoom.getByRole(`searchbox`, { name: `Search atoms` }).fill(`count`)
	await zoom.waitForFunction(
		() => document.querySelector(`.state-search`)?.dataset.ready === `true`,
	)
	for (const target of [
		zoom.getByRole(`searchbox`, { name: `Search atoms` }),
		zoom.getByRole(`button`, { name: `Clear`, exact: true }),
		zoom.locator(`[data-search-id="state:count"]`),
	]) {
		const box = await target.boundingBox()
		assert.ok(box && box.x >= 0 && box.x + box.width <= 195)
	}
	await zoom.screenshot({
		path: `${artifacts}/search-200percent.png`,
		fullPage: true,
	})
	await zoom.getByRole(`button`, { name: `Clear`, exact: true }).click()
	assert.equal(
		await zoom.getByRole(`searchbox`, { name: `Search atoms` }).inputValue(),
		``,
	)
	report.zoom = {
		physicalViewport: `390x900`,
		cssViewport: `195x450`,
		emulation: `200%`,
		reachable: true,
	}
	await zoom.close()

	report.stage = `cold atoms capture and index`
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
	await page.goto(`http://127.0.0.1:${server.address().port}`)
	await page.evaluate(() => {
		window.searchFixture.mount(true)
	})
	await page.waitForFunction(
		() => document.querySelector(`.state-search`)?.dataset.ready === `true`,
	)
	report.scale.overview = await page.evaluate(() => ({
		elapsedMs: performance.now() - window.searchFixture.evidence().mountStarted,
		...document.querySelector(`.state-search`).dataset,
	}))
	report.scale.evidence = await page.evaluate(() => {
		const e = window.searchFixture.evidence()
		return {
			reads: e.reads,
			cache: e.cache.length,
			atoms: e.atoms.length,
			setupMs: e.setupMs,
			selectors: e.selectors,
			observedEdges: e.observedEdges,
		}
	})
	const sample = async (query) =>
		page.evaluate(async (text) => {
			const host = document.querySelector(`.state-search`),
				input = host.querySelector(`input`),
				start = performance.now()
			input.value = text
			input.dispatchEvent(new Event(`input`, { bubbles: true }))
			while (host.dataset.ready !== `true`)
				await new Promise((resolve) => setTimeout(resolve, 0))
			const settledMs = performance.now() - start
			const frame = await new Promise((resolve) =>
				requestAnimationFrame(() => {
					resolve(performance.now())
				}),
			)
			return {
				query: text,
				settledMs,
				firstFrameProxyMs: frame - start,
				...host.dataset,
			}
		}, query)
	const queries = [
		`cartQuantity0`,
		`cart quan`,
		`SKU-0-17`,
		`cartQuantitz0`,
		`no-such-record`,
		`cart`,
	]
	report.stage = `atoms cold match, warmups and measured queries`
	report.scale.cold = await sample(queries[0])
	report.scale.warmupSamples = []
	for (let i = 0; i < 6; i++)
		report.scale.warmupSamples.push(await sample(queries[i]))
	report.scale.warmup = 6
	report.scale.samples = []
	for (let i = 0; i < 30; i++)
		report.scale.samples.push(await sample(queries[i % queries.length]))
	report.scale.p95Ms = report.scale.samples
		.map((item) => item.settledMs)
		.sort((a, b) => a - b)[28]
	report.scale.maxChunkMs = Math.max(
		...[
			report.scale.cold,
			...report.scale.warmupSamples,
			...report.scale.samples,
		].map((item) => Number(item.maxMatchChunkMs)),
		Number(report.scale.overview.maxIndexChunkMs),
	)
	report.scale.selection = await page.evaluate(async () => {
		const button = document.querySelector(`.search-results button`),
			samples = []
		for (let i = 0; i < 33; i++) {
			const start = performance.now()
			button.click()
			const commitMs = performance.now() - start
			const frame = await new Promise((resolve) =>
				requestAnimationFrame(() => {
					resolve(performance.now())
				}),
			)
			if (i >= 3) samples.push({ commitMs, firstFrameProxyMs: frame - start })
		}
		return {
			warmup: 3,
			samples,
			p95Ms: samples.map((item) => item.commitMs).sort((a, b) => a - b)[28],
		}
	})
	report.scale.frameBaseline = await page.evaluate(async () => {
		const intervals = []
		let prior = await new Promise((resolve) => requestAnimationFrame(resolve))
		for (let i = 0; i < 30; i++) {
			const next = await new Promise((resolve) => requestAnimationFrame(resolve))
			intervals.push(next - prior)
			prior = next
		}
		return {
			intervals,
			medianMs: [...intervals].sort((a, b) => a - b)[15],
			claim: `rAF observations are frame proxies, not verified paint or input latency`,
		}
	})
	assert.ok(report.scale.selection.p95Ms <= 100)

	await page.evaluate(() => {
		const input = document.querySelector(`.search-row input`)
		for (const text of [`old`, `discarded`, `cartQuantity0`]) {
			input.value = text
			input.dispatchEvent(new Event(`input`, { bubbles: true }))
		}
	})
	await page.waitForFunction(
		() => document.querySelector(`.state-search`)?.dataset.ready === `true`,
	)
	assert.match(
		await page.locator(`.search-results`).innerText(),
		/cartQuantity0/,
	)
	assert.equal(
		await page.evaluate(() => window.searchFixture.evidence().reads),
		0,
	)
	report.stage = `cold selectors capture and index`
	const selectorStarted = await page.evaluate(() => performance.now())
	await page.getByRole(`tab`, { name: `selectors`, exact: true }).click()
	await page.waitForFunction(
		() => document.querySelector(`.state-search`)?.dataset.ready === `true`,
	)
	report.scale.selectors = {
		overview: await page.evaluate(
			(started) => ({
				elapsedMs: performance.now() - started,
				...document.querySelector(`.state-search`).dataset,
			}),
			selectorStarted,
		),
		warmup: 6,
		samples: [],
	}
	const selectorQueries = [
		`orderTotal0`,
		`order tot`,
		`Total`,
		`orderTottal0`,
		`no-such-record`,
		`order`,
	]
	report.stage = `selectors cold match, warmups and measured queries`
	report.scale.selectors.cold = await sample(selectorQueries[0])
	report.scale.selectors.warmupSamples = []
	for (let i = 0; i < 6; i++)
		report.scale.selectors.warmupSamples.push(await sample(selectorQueries[i]))
	for (let i = 0; i < 30; i++)
		report.scale.selectors.samples.push(
			await sample(selectorQueries[i % selectorQueries.length]),
		)
	report.scale.selectors.p95Ms = report.scale.selectors.samples
		.map((item) => item.settledMs)
		.sort((a, b) => a - b)[28]
	report.scale.selectors.maxChunkMs = Math.max(
		...[
			report.scale.selectors.cold,
			...report.scale.selectors.warmupSamples,
			...report.scale.selectors.samples,
		].map((item) => Number(item.maxMatchChunkMs)),
		Number(report.scale.selectors.overview.maxIndexChunkMs),
	)
	assert.equal(
		await page.evaluate(() => window.searchFixture.evidence().reads),
		0,
	)
	assert.equal(
		report.scale.evidence.atoms + report.scale.evidence.selectors,
		10_000,
	)
	assert.equal(report.scale.evidence.observedEdges, 30_000)
	const summarize = (samples) => {
		const sorted = [...samples].sort((a, b) => a - b)
		return {
			count: sorted.length,
			p50: sorted[Math.floor(sorted.length * 0.5)],
			p95: sorted[Math.floor(sorted.length * 0.95)],
			p99: sorted[Math.floor(sorted.length * 0.99)],
			max: sorted.at(-1),
		}
	}
	report.scale.distributions = {
		atomIndex: summarize(JSON.parse(report.scale.overview.indexChunks)),
		atomMatching: summarize(
			[
				report.scale.cold,
				...report.scale.warmupSamples,
				...report.scale.samples,
			].flatMap((sample) => JSON.parse(sample.matchChunks)),
		),
		selectorIndex: summarize(
			JSON.parse(report.scale.selectors.overview.indexChunks),
		),
		selectorMatching: summarize(
			[
				report.scale.selectors.cold,
				...report.scale.selectors.warmupSamples,
				...report.scale.selectors.samples,
			].flatMap((sample) => JSON.parse(sample.matchChunks)),
		),
	}

	assert.ok(report.scale.selectors.overview.elapsedMs <= 500)
	assert.ok(report.scale.selectors.p95Ms <= 100)
	assert.ok(report.scale.selectors.maxChunkMs <= 8)

	report.stage = `preparation and Refresh lifecycle races`
	// Exercise real browser task boundaries while normalization is still in flight,
	// rather than waiting for readiness before every input as the steady-state timings do.
	const race = await browser.newPage({ viewport: { width: 1440, height: 900 } })
	race.setDefaultTimeout(5_000)
	await race.goto(`http://127.0.0.1:${server.address().port}`)
	report.races = {
		method: `Ordinary DOM InputEvents across real scheduled task boundaries during preparation; no synthetic clock or scheduler replacement.`,
	}
	report.races.initial = await race.evaluate(async () => {
		window.searchFixture.mount(true)
		const host = document.querySelector(`.state-search`),
			input = host.querySelector(`input`),
			observations = []
		for (const text of [`cart`, `discarded`, `cartQuantity0`]) {
			await new Promise((resolve) => setTimeout(resolve, 0))
			observations.push({
				preparing: host
					.querySelector(`.search-status`)
					.textContent.startsWith(`Preparing`),
				ready: host.dataset.ready,
				busy: host.querySelector(`ol`).getAttribute(`aria-busy`),
				text,
			})
			input.value = text
			input.dispatchEvent(
				new InputEvent(`input`, {
					data: text,
					inputType: `insertText`,
					bubbles: true,
				}),
			)
		}
		return observations
	})
	assert.ok(
		report.races.initial.every(
			(entry) =>
				entry.preparing && entry.ready === `false` && entry.busy === `true`,
		),
	)
	await race.waitForFunction(
		() => document.querySelector(`.state-search`)?.dataset.ready === `true`,
	)
	assert.match(
		await race.locator(`.search-results`).innerText(),
		/cartQuantity0/,
	)
	report.races.refresh = await race.evaluate(async () => {
		window.searchFixture.update()
		const host = document.querySelector(`.state-search`),
			input = host.querySelector(`input`),
			observations = []
		;[...host.querySelectorAll(`button`)]
			.find((button) => button.textContent === `Refresh`)
			.click()
		for (const text of [`SKU`, `discarded`, `refreshed`]) {
			await new Promise((resolve) => setTimeout(resolve, 0))
			observations.push({
				preparing: host
					.querySelector(`.search-status`)
					.textContent.startsWith(`Preparing`),
				ready: host.dataset.ready,
				busy: host.querySelector(`ol`).getAttribute(`aria-busy`),
				text,
			})
			input.value = text
			input.dispatchEvent(
				new InputEvent(`input`, {
					data: text,
					inputType: `insertText`,
					bubbles: true,
				}),
			)
		}
		return observations
	})
	assert.ok(
		report.races.refresh.every(
			(entry) =>
				entry.preparing && entry.ready === `false` && entry.busy === `true`,
		),
	)
	await race.waitForFunction(
		() => document.querySelector(`.state-search`)?.dataset.ready === `true`,
	)
	assert.match(
		await race.locator(`.search-results`).innerText(),
		/cached value: refreshed/,
	)
	assert.equal(await race.locator(`.search-results li`).count(), 1)
	assert.equal(
		await race.evaluate(() => window.searchFixture.evidence().reads),
		0,
	)
	await race.close()

	assert.ok(
		report.scale.overview.elapsedMs <= 500,
		`overview ${report.scale.overview.elapsedMs}ms`,
	)
	assert.ok(report.scale.p95Ms <= 100, `search p95 ${report.scale.p95Ms}ms`)
	assert.ok(
		report.scale.maxChunkMs <= 8,
		`max scheduled slice ${report.scale.maxChunkMs}ms`,
	)
} catch (error) {
	report.failure = {
		stage: report.stage,
		name: error.name,
		message: error.message,
	}
	throw error
} finally {
	console.log(
		JSON.stringify({
			candidate: report.candidate,
			ci: report.ci,
			stage: report.stage,
			failure: report.failure,
			cpuRate,
			atomOverview: report.scale.overview,
			atomP95: report.scale.p95Ms,
			atomMaxSlice: report.scale.maxChunkMs,
			selectorOverview: report.scale.selectors?.overview,
			selectorP95: report.scale.selectors?.p95Ms,
			selectorMaxSlice: report.scale.selectors?.maxChunkMs,
			distributions: report.scale.distributions,
		}),
	)
	await writeFile(`${artifacts}/report.json`, JSON.stringify(report, null, 2))
	await browser?.close()
	await new Promise((resolve) => server.close(resolve))
}
