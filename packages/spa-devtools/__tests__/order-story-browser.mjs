import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"

import { chromium } from "playwright"

const root = resolve(import.meta.dirname, `../../..`)
const storybook =
	process.env.SPA_DEVTOOLS_STORYBOOK_DIR ??
	resolve(root, `.scratch/s6a-storybook`)
const developmentUrl = process.env.SPA_DEVTOOLS_STORYBOOK_URL
const artifacts =
	process.env.SPA_DEVTOOLS_STORY_ARTIFACTS ?? `/tmp/s6a-story-browser`
await mkdir(artifacts, { recursive: true })
// Fail clearly if the actual Storybook build has not been produced.
if (!developmentUrl) await readFile(resolve(storybook, `index.json`))
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
if (!developmentUrl)
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
		const url = developmentUrl ?? `http://127.0.0.1:${server.address().port}`
		await page.goto(
			`${url}/iframe.html?id=atomiodevtools--ecology-order-fulfillment&viewMode=story`,
		)
		await page.getByTestId(`order-summary`).waitFor()
		await page.getByTestId(`ecology-view`).waitFor()
		assert.equal(await page.locator(`iframe[name="order-debugger"]`).count(), 0)
		const debug = page
		if (developmentUrl) {
			const client = await page.request.get(`${url}/@vite/client`)
			assert.match(await client.text(), /createHotContext/)
		}
		const developmentModules = developmentUrl
			? await page.evaluate(() =>
					performance
						.getEntriesByType(`resource`)
						.map((entry) => entry.name)
						.filter((name) =>
							/react|spa\/|OrderFulfillment|devtools-order/.test(name),
						),
				)
			: []
		activeDebug = debug
		const preferences = await page.evaluate(() => ({
			geometry: localStorage.getItem(`🔍 Devtools Window`),
			view: localStorage.getItem(`🔍 Devtools View`),
		}))
		assert.equal(preferences.geometry, null)
		const drawer = page.locator(`.order-fulfillment-controls`)
		const setControls = async (open) => {
			if ((await drawer.evaluate((el) => el.open)) !== open)
				await drawer.locator(`summary`).click()
		}
		const appAction = async (name) => {
			await setControls(true)
			await page.getByRole(`button`, { name, exact: true }).click()
		}
		const checkControls = async () => {
			await setControls(true)
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
		await setControls(false)
		await page.screenshot({
			path: resolve(profileArtifacts, `story-layout.png`),
			fullPage: true,
		})
		const layout = await page.evaluate(() => ({
			canvas: { width: innerWidth, height: innerHeight },
			debuggerDocument:
				document.querySelector(`[data-testid="atom-io-devtools"]`)
					.ownerDocument === document,
			overflow: document.documentElement.scrollWidth > innerWidth,
			controls: document
				.querySelector(`.order-fulfillment-controls`)
				.getBoundingClientRect()
				.toJSON(),
		}))
		assert.equal(layout.debuggerDocument, true)
		assert.equal(layout.overflow, false)

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
			await setControls(false)
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
		await appAction(`Use pickup`)
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
		await appAction(`Use south warehouse`)
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
		await appAction(`Add oolong tea`)
		await refresh()
		await choose(`cartQuantityBySku`, true)
		assert.match(await inspector.innerText(), /7 instantiated members/)
		await appAction(`Remove oolong tea`)
		await refresh()
		assert.match(await inspector.innerText(), /6 instantiated members/)
		await choose(`seasonalPromotion`)
		await trace()
		assert.match(await inspector.innerText(), /not cached \/ unknown/)
		await choose(`lazyAuditDefault("unused")`)
		await trace()
		assert.match(await inspector.innerText(), /not cached \/ unknown/)
		await appAction(`Two green teas`)
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-testid="order-summary"]`)
				?.textContent.includes(`40.75`),
		)
		await appAction(`Undo cart`)
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-testid="order-summary"]`)
				?.textContent.includes(`35.75`),
		)
		await appAction(`Redo cart`)
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-testid="order-summary"]`)
				?.textContent.includes(`40.75`),
		)
		for (const outcome of [`Resolve quote`, `Reject quote`]) {
			await appAction(`Request quote`)
			assert.equal(
				await page.getByLabel(`Carrier quote status`).innerText(),
				`pending`,
			)
			await appAction(outcome)
			assert.equal(
				await page.getByLabel(`Carrier quote status`).innerText(),
				outcome === `Resolve quote` ? `ready` : `error`,
			)
		}
		const resetBindings = []
		for (let i = 0; i < 3; i++) {
			await appAction(`Reset order scenario`)
			await page.waitForFunction(() =>
				document
					.querySelector(`[data-testid="order-summary"]`)
					?.textContent.includes(`40.25`),
			)
			assert.equal(await debug.getByTestId(`atom-io-devtools`).count(), 1)
			await ready()
			const counts = await graph.locator(`.ecology-counts`).innerText()
			assert.match(counts, /^95 atoms · 18 selectors/)
			assert.match(counts, /51 captured edges/)
			await choose(`fulfillmentFeeCents`)
			await trace()
			const roots = await inspector.innerText()
			assert.match(roots, /deliveryRegion/)
			assert.doesNotMatch(roots, /pickupStore/)
			resetBindings.push({ counts, roots })
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
		const panel = debug.getByTestId(`atom-io-devtools`)
		const beforeGesture = await panel.boundingBox()
		const corner = await debug.locator(`[data-resize="nw"]`).boundingBox()
		await page.mouse.move(
			corner.x + corner.width / 2,
			corner.y + corner.height / 2,
		)
		await page.mouse.down()
		await page.mouse.move(corner.x + 40, corner.y + 80, { steps: 6 })
		await page.mouse.up()
		const resized = await panel.boundingBox()
		assert.ok(resized.height < beforeGesture.height)
		const handle = await debug
			.getByRole(`button`, { name: `Move debugger`, exact: true })
			.boundingBox()
		await page.mouse.move(
			handle.x + handle.width / 2,
			handle.y + handle.height / 2,
		)
		await page.mouse.down()
		// Release away from the top snap palette so this exercises free movement.
		await page.mouse.move(80, viewport.height / 2, { steps: 8 })
		await page.mouse.up()
		const moved = await panel.boundingBox()
		assert.ok(moved.x >= 0 && moved.x < viewport.width / 2)
		assert.ok(moved.y >= 0 && moved.y + moved.height <= viewport.height + 1)
		await page.screenshot({
			path: resolve(profileArtifacts, `shared-canvas-gestures.png`),
		})
		const gestures = { beforeGesture, resized, moved }
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
		const primaryGraph = page.getByTestId(`ecology-view`)
		await page.waitForFunction(
			() =>
				document.querySelector(`[data-testid="ecology-view"]`)?.dataset.ready ===
				`true`,
		)
		const primaryCounts = await primaryGraph
			.locator(`.ecology-counts`)
			.innerText()
		assert.match(primaryCounts, /^11 atoms · 2 selectors/)
		assert.match(primaryCounts, /0 captured edges/)
		assert.equal(await page.getByTestId(`atom-io-devtools`).count(), 1)
		// Exercise the actual manager's same-document transition, not a fresh iframe.
		const manager = await context.newPage()
		activePage = manager
		manager.on(`pageerror`, (error) => errors.push(error.message))
		await manager.goto(`${url}/?path=/story/atomiodevtools--primary`)
		const frame = await (
			await manager.locator(`#storybook-preview-iframe`).elementHandle()
		).contentFrame()
		await frame.getByTestId(`ecology-view`).waitFor()
		await frame.evaluate(() => {
			window.__orderStoryDocument = true
		})
		const navigation = manager.getByRole(`button`, {
			name: `Open navigation menu`,
			exact: true,
		})
		if (await navigation.isVisible()) await navigation.click()
		await manager
			.locator(`a[href*="/story/atomiodevtools--ecology-order-fulfillment"]`)
			.first()
			.click()
		await frame.getByTestId(`order-summary`).waitFor()
		const transitionCounts = []
		for (let reset = 0; reset < 3; reset++) {
			// Storybook's own development announcement can cover the mobile iframe.
			for (const dismiss of await manager
				.getByRole(`button`, { name: `Dismiss notification`, exact: true })
				.all()) {
				if (await dismiss.isVisible()) await dismiss.click()
			}
			if (reset)
				await frame
					.getByRole(`button`, { name: `Reset order scenario`, exact: true })
					.click()
			await frame.waitForFunction(
				() =>
					document.querySelector(`[data-testid="ecology-view"]`)?.dataset
						.ready === `true`,
			)
			const transitionGraph = frame.getByTestId(`ecology-view`)
			const jobs = await transitionGraph.getAttribute(`data-jobs`)
			await transitionGraph
				.getByRole(`button`, { name: `Refresh`, exact: true })
				.click()
			await frame.waitForFunction(
				(previous) =>
					document.querySelector(`[data-testid="ecology-view"]`)?.dataset
						.jobs !== previous,
				jobs,
			)
			const counts = await transitionGraph.locator(`.ecology-counts`).innerText()
			assert.match(counts, /^95 atoms · 18 selectors/)
			assert.match(counts, /51 captured edges/)
			assert.equal(await frame.getByTestId(`atom-io-devtools`).count(), 1)
			transitionCounts.push(counts)
		}
		assert.equal(await frame.evaluate(() => window.__orderStoryDocument), true)
		await manager.screenshot({
			path: resolve(profileArtifacts, `primary-to-order.png`),
		})
		await manager.close()
		activePage = page
		assert.deepEqual(errors, [])
		profiles.push({
			viewport,
			primaryCounts,
			transitionCounts,
			sameDocumentPrimaryToOrder: true,
			controls,
			layout,
			gestures,
			delivery,
			pickup,
			repeatedResets: 3,
			resetBindings,
			developmentModules,
			preferencesUnchangedByStoryAndApp: true,
			sharedCanvasLiveEdit: true,
			fullStoryCanvasSnap: snapped,
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
				mode: developmentUrl ? `development` : `static`,
				developmentUrl,
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
	if (server.listening) await new Promise((done) => server.close(done))
}
