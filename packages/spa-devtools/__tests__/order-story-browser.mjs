import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"

import { launchBrowser } from "./browser-runtime.mjs"

const root = resolve(import.meta.dirname, `../../..`)
const storybook =
	process.env.SPA_DEVTOOLS_STORYBOOK_DIR ??
	resolve(root, `.scratch/s6a-storybook`)
assert.equal(
	process.env.SPA_DEVTOOLS_STORYBOOK_URL,
	undefined,
	`This suite tests built Storybook. Use the Vitest story project for interaction tests.`,
)
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
let browser, activePage, activeContext, activeProfile
const profiles = []
const provenance = {
	candidate: process.env.SPA_DEVTOOLS_CANDIDATE_SHA ?? `working-tree`,
	pullRequestHead: process.env.SPA_DEVTOOLS_PR_HEAD_SHA ?? null,
	testedRevision: process.env.GITHUB_SHA ?? null,
	mode: `static`,
	developmentServer: false,
	hmr: false,
	storybook,
}
// Wait for Storybook's render lifecycle so the suite does not race the story's play function.
const finished = async (frame, id) => {
	await frame.waitForFunction(
		(storyId) =>
			window.__STORYBOOK_PREVIEW__?.storyRenders?.some(
				(render) => render.id === storyId && render.phase === `finished`,
			),
		id,
	)
	assert.equal(
		await frame
			.locator(`body`)
			.evaluate((body) => body.classList.contains(`sb-show-main`)),
		true,
	)
	assert.equal(await frame.getByTestId(`atom-io-devtools`).count(), 1)
}
try {
	browser = await launchBrowser()
	const url = `http://127.0.0.1:${server.address().port}`
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 390, height: 844 },
		{ width: 320, height: 740 },
		{ width: 768, height: 1024 },
	]) {
		activeProfile = resolve(artifacts, `${viewport.width}x${viewport.height}`)
		await mkdir(activeProfile, { recursive: true })
		const context = await browser.newContext({ viewport })
		activeContext = context
		await context.tracing.start({ screenshots: true, snapshots: true })
		const page = await context.newPage(),
			errors = [],
			assetFailures = []
		activePage = page
		page.on(`pageerror`, (error) => errors.push(error.message))
		page.on(`response`, (response) => {
			if (
				response.status() >= 400 &&
				/\.(?:js|css|woff2?|png|svg)(?:\?|$)/.test(response.url())
			)
				assetFailures.push({ url: response.url(), status: response.status() })
		})
		const orderId = `atomiodevtools--ecology-order-fulfillment`
		await page.goto(`${url}/iframe.html?id=${orderId}&viewMode=story`)
		await finished(page, orderId)
		assert.equal(await page.locator(`iframe[name="order-debugger"]`).count(), 0)
		const layout = await page.evaluate(() => ({
			debuggerDocument:
				document.querySelector(`[data-testid="atom-io-devtools"]`)
					.ownerDocument === document,
			overflow: document.documentElement.scrollWidth > innerWidth,
		}))
		assert.equal(layout.debuggerDocument, true)
		assert.equal(layout.overflow, false)
		const drawer = page.locator(`.order-fulfillment-controls`)
		const controls = async (open) => {
			if ((await drawer.evaluate((element) => element.open)) !== open)
				await drawer.locator(`summary`).click()
		}
		const checkControls = async () => {
			await controls(true)
			for (const button of await drawer.locator(`button`).all()) {
				await button.scrollIntoViewIfNeeded()
				assert.equal(
					await button.evaluate((element) => {
						const rect = element.getBoundingClientRect()
						const hit = document.elementFromPoint(
							rect.x + rect.width / 2,
							rect.y + rect.height / 2,
						)
						return (
							rect.left >= 0 &&
							rect.right <= innerWidth &&
							(hit === element || element.contains(hit))
						)
					}),
					true,
				)
			}
			await controls(false)
		}
		await checkControls()
		await page.screenshot({ path: resolve(activeProfile, `story-layout.png`) })
		// Real pointer capture and viewport geometry are built-output integration checks.
		const panel = page.getByTestId(`atom-io-devtools`)
		const beforeGesture = await panel.boundingBox()
		const corner = await page.locator(`[data-resize="nw"]`).boundingBox()
		await page.mouse.move(
			corner.x + corner.width / 2,
			corner.y + corner.height / 2,
		)
		await page.mouse.down()
		await page.mouse.move(corner.x + 40, corner.y + 80, { steps: 6 })
		await page.mouse.up()
		const resized = await panel.boundingBox()
		assert.ok(resized.height < beforeGesture.height)
		const handle = await page
			.getByRole(`button`, { name: `Move debugger`, exact: true })
			.boundingBox()
		await page.mouse.move(
			handle.x + handle.width / 2,
			handle.y + handle.height / 2,
		)
		await page.mouse.down()
		await page.mouse.move(80, viewport.height / 2, { steps: 8 })
		await page.mouse.up()
		const moved = await panel.boundingBox()
		assert.ok(moved.x >= 0 && moved.x < viewport.width / 2)
		assert.ok(moved.y >= 0 && moved.y + moved.height <= viewport.height + 1)
		await page
			.getByRole(`button`, { name: `Debugger layout`, exact: true })
			.click()
		await page
			.getByRole(`button`, { name: `Full viewport`, exact: true })
			.click()
		const snapped = await panel.boundingBox()
		assert.deepEqual(snapped, {
			x: 0,
			y: 0,
			width: viewport.width,
			height: viewport.height,
		})
		await checkControls()
		await page.screenshot({
			path: resolve(activeProfile, `full-snap-controls.png`),
			fullPage: true,
		})

		// Static MDX/docgen is outside the Vitest addon's story transformation.
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
		await page.screenshot({ path: resolve(activeProfile, `props-docs.png`) })

		// Navigate the real manager without replacing its preview document.
		await page.goto(`${url}/?path=/story/atomiodevtools--primary`)
		const frame = await (
			await page.locator(`#storybook-preview-iframe`).elementHandle()
		).contentFrame()
		await finished(frame, `atomiodevtools--primary`)
		assert.match(
			await frame.locator(`.ecology-counts`).innerText(),
			/^11 atoms · 2 selectors/,
		)
		await frame.evaluate(() => {
			window.__orderStoryDocument = true
		})
		const navigation = page.getByRole(`button`, {
			name: `Open navigation menu`,
			exact: true,
		})
		if (await navigation.isVisible()) await navigation.click()
		await page.locator(`a[href*="/story/${orderId}"]`).first().click()
		await finished(frame, orderId)
		assert.equal(await frame.evaluate(() => window.__orderStoryDocument), true)
		const transitionCounts = await frame.locator(`.ecology-counts`).innerText()
		assert.match(transitionCounts, /^95 atoms · 18 selectors/)
		assert.match(transitionCounts, /51 captured edges/)
		// One reset is enough here to establish rebinding in the built manager.
		// Repeated reset behavior and root assertions belong to the play tests.
		for (const dismiss of await page
			.getByRole(`button`, { name: `Dismiss notification`, exact: true })
			.all())
			if (await dismiss.isVisible()) await dismiss.click()
		const managerDrawer = frame.locator(`.order-fulfillment-controls`)
		if (!(await managerDrawer.evaluate((element) => element.open)))
			await managerDrawer.locator(`summary`).click()
		await frame
			.getByRole(`button`, { name: `Reset order scenario`, exact: true })
			.click()
		await frame.waitForFunction(
			() =>
				document.querySelector(`[data-testid="ecology-view"]`)?.dataset.ready ===
				`true`,
		)
		assert.equal(await frame.getByTestId(`atom-io-devtools`).count(), 1)
		assert.match(
			await frame.locator(`.ecology-counts`).innerText(),
			/^95 atoms · 18 selectors/,
		)
		await page.screenshot({
			path: resolve(activeProfile, `primary-to-order.png`),
		})
		assert.deepEqual(errors, [])
		assert.deepEqual(assetFailures, [])
		profiles.push({
			viewport,
			layout,
			gestures: { beforeGesture, resized, moved },
			snapped,
			transitionCounts,
			sameDocument: true,
			propsDocs: true,
			errors,
			assetFailures,
		})
		await context.tracing.stop({ path: resolve(activeProfile, `trace.zip`) })
		await context.close()
		activeContext = undefined
	}
	await writeFile(
		resolve(artifacts, `report.json`),
		JSON.stringify(
			{
				...provenance,
				browser: browser.version(),
				chromiumSandbox: true,
				profiles,
			},
			null,
			2,
		),
	)
} catch (error) {
	// Preserve the original failure even when diagnostic capture itself cannot finish.
	await Promise.allSettled([
		activePage?.screenshot({
			path: resolve(activeProfile ?? artifacts, `failure.png`),
		}),
		activeContext?.tracing.stop({
			path: resolve(activeProfile ?? artifacts, `failure-trace.zip`),
		}),
		writeFile(
			resolve(artifacts, `failure.json`),
			JSON.stringify({ ...provenance, error: String(error) }, null, 2),
		),
	])
	throw error
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
