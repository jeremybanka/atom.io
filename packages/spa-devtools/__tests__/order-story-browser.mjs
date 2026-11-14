import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"

import { chromium } from "playwright"

const root = resolve(import.meta.dirname, `../../..`)
const storybook =
	process.env.SPA_DEVTOOLS_STORYBOOK_DIR ??
	resolve(root, `.scratch/s6a-storybook`)
const artifacts =
	process.env.SPA_DEVTOOLS_STORY_ARTIFACTS ?? `/tmp/s6a-story-browser`
await mkdir(artifacts, { recursive: true })
// Fail clearly if the actual Storybook build has not been produced.
await readFile(resolve(storybook, `index.json`))
const types = {
	".html": `text/html`,
	".js": `application/javascript`,
	".css": `text/css`,
	".json": `application/json`,
	".svg": `image/svg+xml`,
	".png": `image/png`,
}
const server = createServer(async (req, res) => {
	const path = resolve(
		storybook,
		`.${decodeURIComponent(new URL(req.url, `http://localhost`).pathname === `/` ? `/index.html` : new URL(req.url, `http://localhost`).pathname)}`,
	)
	if (!path.startsWith(storybook + sep)) {
		res.writeHead(403).end()
		return
	}
	try {
		res.setHeader(
			`content-type`,
			types[extname(path)] ?? `application/octet-stream`,
		)
		res.end(await readFile(path))
	} catch {
		res.writeHead(404).end()
	}
})
await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
let browser, activePage, activeDebug, activeProfile
const profiles = []
try {
	browser = await chromium.launch({ chromiumSandbox: true })
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 390, height: 844 },
		{ width: 320, height: 740 },
		{ width: 768, height: 1024 },
	]) {
		const profileArtifacts = resolve(
			artifacts,
			`${viewport.width}x${viewport.height}`,
		)
		await mkdir(profileArtifacts, { recursive: true })
		const context = await browser.newContext({ viewport })
		await context.addInitScript(() => {
			// Select ecology in this fresh test origin; leave window geometry unseeded.
			localStorage.setItem(`🔍 Devtools View`, JSON.stringify(`ecology`))
		})
		const page = await context.newPage(),
			errors = []
		activePage = page
		activeProfile = profileArtifacts
		page.on(`pageerror`, (error) => errors.push(error.message))
		const url = `http://127.0.0.1:${server.address().port}`
		await page.goto(
			`${url}/iframe.html?id=atomiodevtools--ecology-order-fulfillment&viewMode=story`,
		)
		await page.getByTestId(`order-summary`).waitFor()
		await page
			.frameLocator(`iframe[name="order-debugger"]`)
			.getByTestId(`ecology-view`)
			.waitFor()
		const debug = page.frame({ name: `order-debugger` })
		assert.ok(debug)
		activeDebug = debug
		const preferences = await page.evaluate(() => ({
			geometry: localStorage.getItem(`🔍 Devtools Window`),
			view: localStorage.getItem(`🔍 Devtools View`),
		}))
		assert.equal(preferences.geometry, null)
		const checkControls = async () => {
			const measured = []
			for (const button of await page
				.locator(`.order-fulfillment-controls button`)
				.all()) {
				await button.scrollIntoViewIfNeeded()
				const sample = await button.evaluate((el) => {
					const r = el.getBoundingClientRect(),
						hit = document.elementFromPoint(
							r.x + r.width / 2,
							r.y + r.height / 2,
						)
					return {
						label: el.textContent.trim(),
						reachable: hit === el || el.contains(hit),
						left: r.left,
						right: r.right,
						width: r.width,
					}
				})
				assert.ok(
					sample.reachable && sample.left >= 0 && sample.right <= viewport.width,
					JSON.stringify(sample),
				)
				measured.push(sample)
			}
			return measured
		}
		const controls = await checkControls()
		await page.screenshot({
			path: resolve(profileArtifacts, `story-layout.png`),
			fullPage: true,
		})
		const layout = await page.evaluate(() => {
			const app = document
					.querySelector(`.order-fulfillment-controls`)
					.getBoundingClientRect(),
				frame = document
					.querySelector(`.order-fulfillment-debugger`)
					.getBoundingClientRect()
			return {
				overlap:
					app.left < frame.right &&
					app.right > frame.left &&
					app.top < frame.bottom &&
					app.bottom > frame.top,
				overflow: document.documentElement.scrollWidth > innerWidth,
				stacked: frame.top >= app.bottom,
			}
		})
		assert.equal(layout.overlap, false)
		assert.equal(layout.overflow, false)
		if (viewport.width <= 900) assert.equal(layout.stacked, true)
		const graph = debug.getByTestId(`ecology-view`),
			inspector = graph.locator(`.ecology-inspector`)
		const ready = async () => {
			await debug.waitForFunction(
				() =>
					document.querySelector(`[data-testid="ecology-view"]`)?.dataset
						.ready === `true`,
			)
		}
		const project = async (action) => {
			const before = await graph.getAttribute(`data-jobs`)
			await action()
			await debug.waitForFunction(
				(old) =>
					document.querySelector(`[data-testid="ecology-view"]`)?.dataset
						.jobs !== old,
				before,
			)
			await ready()
		}
		const revealDebugger = async () => {
			await page
				.locator(`iframe[name="order-debugger"]`)
				.scrollIntoViewIfNeeded()
		}
		const choose = async (key, family = false) => {
			await revealDebugger()
			await project(() =>
				debug.getByRole(`textbox`, { name: `Search ecology` }).fill(key),
			)
			const details = graph.locator(`details`)
			if (!(await details.evaluate((el) => el.open)))
				await details.locator(`summary`).click()
			await graph
				.locator(
					`.ecology-list [data-graph-id=${JSON.stringify(`${family ? `family` : `state`}:${key}`)}]`,
				)
				.click()
			assert.ok((await inspector.innerText()).includes(key))
		}
		const trace = async () => {
			await revealDebugger()
			await project(() =>
				debug
					.getByRole(`button`, { name: `Trace observed roots`, exact: true })
					.click(),
			)
		}
		const refresh = async () => {
			await revealDebugger()
			await project(() =>
				debug.getByRole(`button`, { name: `Refresh`, exact: true }).click(),
			)
		}
		const showGraph = async () => {
			await revealDebugger()
			if (
				await debug.getByRole(`textbox`, { name: `Search ecology` }).inputValue()
			) {
				await project(() =>
					debug.getByRole(`textbox`, { name: `Search ecology` }).fill(``),
				)
			}
			await debug.getByRole(`button`, { name: `Fit`, exact: true }).click()
		}
		const captureRoots = async (name) => {
			await revealDebugger()
			await inspector
				.locator(`p`)
				.filter({ hasText: `Retained trace:` })
				.scrollIntoViewIfNeeded()
			await page.screenshot({
				path: resolve(profileArtifacts, `${name}-inspector.png`),
			})
		}
		await ready()
		await choose(`fulfillmentFeeCents`)
		await trace()
		const delivery = await inspector.innerText()
		assert.match(delivery, /deliveryRegion/)
		assert.doesNotMatch(delivery, /pickupStore/)
		await captureRoots(`delivery`)
		await showGraph()
		await page.screenshot({
			path: resolve(profileArtifacts, `delivery-roots.png`),
		})
		await page.getByRole(`button`, { name: `Use pickup`, exact: true }).click()
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-testid="order-summary"]`)
				?.textContent.includes(`pickup`),
		)
		await refresh()
		await trace()
		const pickup = await inspector.innerText()
		assert.match(pickup, /pickupStore/)
		assert.doesNotMatch(pickup, /deliveryRegion/)
		await captureRoots(`pickup`)
		await showGraph()
		await page.screenshot({
			path: resolve(profileArtifacts, `pickup-roots.png`),
		})
		await choose(`availableLineCount`)
		await trace()
		assert.match(
			await inspector.innerText(),
			/stockByWarehouseSku\(\["north","tea-green"\]\)/,
		)
		await page
			.getByRole(`button`, { name: `Use south warehouse`, exact: true })
			.click()
		await refresh()
		await trace()
		assert.match(
			await inspector.innerText(),
			/stockByWarehouseSku\(\["south","tea-green"\]\)/,
		)
		assert.doesNotMatch(
			await inspector.innerText(),
			/stockByWarehouseSku\(\["north","tea-green"\]\)/,
		)
		await captureRoots(`south-warehouse`)
		await showGraph()
		await page.screenshot({
			path: resolve(profileArtifacts, `south-warehouse-roots.png`),
		})
		await page
			.getByRole(`button`, { name: `Add oolong tea`, exact: true })
			.click()
		await refresh()
		await choose(`cartQuantityBySku`, true)
		assert.match(await inspector.innerText(), /7 instantiated members/)
		await page
			.getByRole(`button`, { name: `Remove oolong tea`, exact: true })
			.click()
		await refresh()
		assert.match(await inspector.innerText(), /6 instantiated members/)
		await choose(`seasonalPromotion`)
		await trace()
		assert.match(await inspector.innerText(), /not cached \/ unknown/)
		await choose(`lazyAuditDefault("unused")`)
		await trace()
		assert.match(await inspector.innerText(), /not cached \/ unknown/)
		await page
			.getByRole(`button`, { name: `Two green teas`, exact: true })
			.click()
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-testid="order-summary"]`)
				?.textContent.includes(`40.75`),
		)
		await page.getByRole(`button`, { name: `Undo cart`, exact: true }).click()
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-testid="order-summary"]`)
				?.textContent.includes(`35.75`),
		)
		await page.getByRole(`button`, { name: `Redo cart`, exact: true }).click()
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-testid="order-summary"]`)
				?.textContent.includes(`40.75`),
		)
		for (const outcome of [`Resolve quote`, `Reject quote`]) {
			await page
				.getByRole(`button`, { name: `Request quote`, exact: true })
				.click()
			assert.equal(
				await page.getByLabel(`Carrier quote status`).innerText(),
				`pending`,
			)
			await page.getByRole(`button`, { name: outcome, exact: true }).click()
			assert.equal(
				await page.getByLabel(`Carrier quote status`).innerText(),
				outcome === `Resolve quote` ? `ready` : `error`,
			)
		}
		for (let i = 0; i < 3; i++) {
			await page
				.getByRole(`button`, { name: `Reset order scenario`, exact: true })
				.click()
			await page.waitForFunction(() =>
				document
					.querySelector(`[data-testid="order-summary"]`)
					?.textContent.includes(`40.25`),
			)
			assert.equal(await debug.getByTestId(`atom-io-devtools`).count(), 1)
		}
		await choose(`cartQuantityBySku("tea-green")`)
		await debug
			.getByRole(`button`, {
				name: `Open live editor (may read/evaluate)`,
				exact: true,
			})
			.click()
		const editor = debug.locator(`.ecology-live input[inputmode="decimal"]`)
		await editor.fill(`2.`)
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-testid="order-summary"]`)
				?.textContent.includes(`45.25`),
		)
		assert.equal(await editor.inputValue(), `2.`)
		await editor.fill(`1`)
		await checkControls()
		assert.deepEqual(
			await page.evaluate(() => ({
				geometry: localStorage.getItem(`🔍 Devtools Window`),
				view: localStorage.getItem(`🔍 Devtools View`),
			})),
			preferences,
		)
		await revealDebugger()
		await debug
			.getByRole(`button`, { name: `Debugger layout`, exact: true })
			.click()
		await debug
			.getByRole(`button`, { name: `Full viewport`, exact: true })
			.click()
		const snapped = await debug
			.getByTestId(`atom-io-devtools`)
			.evaluate((el) => {
				const r = el.getBoundingClientRect()
				return {
					x: r.x,
					y: r.y,
					width: r.width,
					height: r.height,
					viewportWidth: innerWidth,
					viewportHeight: innerHeight,
				}
			})
		assert.equal(snapped.x, 0)
		assert.equal(snapped.y, 0)
		assert.equal(snapped.width, snapped.viewportWidth)
		assert.equal(snapped.height, snapped.viewportHeight)
		await checkControls()
		await page.screenshot({
			path: resolve(profileArtifacts, `full-snap-controls.png`),
			fullPage: true,
		})
		await page.goto(`${url}/iframe.html?id=atomiodevtools--docs&viewMode=docs`)
		await page.getByText(`OrderSummary`, { exact: true }).first().waitFor()
		const summaryTab = page.getByRole(`tab`, {
			name: `OrderSummary`,
			exact: true,
		})
		if (await summaryTab.count()) await summaryTab.click()
		await page
			.getByRole(`row`)
			.filter({ hasText: /scenario/ })
			.first()
			.waitFor()
		await page.screenshot({ path: resolve(profileArtifacts, `props-docs.png`) })
		await page.goto(
			`${url}/iframe.html?id=atomiodevtools--primary&viewMode=story`,
		)
		await page.getByRole(`button`, { name: `run`, exact: true }).waitFor()
		assert.equal(await page.getByTestId(`order-summary`).count(), 0)
		assert.deepEqual(errors, [])
		profiles.push({
			viewport,
			controls,
			layout,
			delivery,
			pickup,
			repeatedResets: 3,
			preferencesUnchangedByStoryAndApp: true,
			frameLiveEdit: true,
			fullSnapWithinFrame: snapped,
			errors,
		})
		await context.close()
	}
	await writeFile(
		resolve(artifacts, `report.json`),
		JSON.stringify(
			{
				candidate: process.env.SPA_DEVTOOLS_CANDIDATE_SHA ?? `working-tree`,
				browser: browser.version(),
				chromiumSandbox: true,
				actualStorybook: true,
				propsDocs: true,
				profiles,
			},
			null,
			2,
		),
	)
} catch (error) {
	if (activePage)
		await activePage.screenshot({ path: resolve(activeProfile, `failure.png`) })
	if (activeDebug)
		await writeFile(
			resolve(activeProfile, `failure.json`),
			JSON.stringify(
				await activeDebug.evaluate(() => ({
					width: innerWidth,
					height: innerHeight,
					elements: [
						...document.querySelectorAll(
							`main,.ecology,.ecology-body,.ecology-map,details,summary`,
						),
					].map((el) => ({
						tag: el.tagName,
						class: el.className,
						rect: el.getBoundingClientRect().toJSON(),
						overflow: getComputedStyle(el).overflow,
					})),
				})),
				null,
				2,
			),
		)
	throw error
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
