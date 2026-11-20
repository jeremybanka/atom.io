import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { extname, resolve, sep } from "node:path"

import type { Browser, BrowserContext, Frame, Page } from "playwright"

import { launchBrowser } from "./browser-runtime.ts"

declare global {
	interface Window {
		__STORYBOOK_PREVIEW__?: {
			storyRenders?: { id: string; phase: string }[]
		}
		__orderStoryDocument?: boolean
	}
}

const root = resolve(import.meta.dirname, `../../..`)
const storybook =
	process.env[`SPA_DEVTOOLS_STORYBOOK_DIR`] ??
	resolve(root, `packages/atom.io/storybook-static`)
assert.equal(
	process.env[`SPA_DEVTOOLS_STORYBOOK_URL`],
	undefined,
	`This suite tests built Storybook. Use the Vitest story project for interaction tests.`,
)
const artifacts =
	process.env[`SPA_DEVTOOLS_STORY_ARTIFACTS`] ??
	resolve(root, `.scratch/storybook-tests/integration`)
await mkdir(artifacts, { recursive: true })
// Fail clearly if the actual Storybook build has not been produced.
await readFile(resolve(storybook, `index.json`))
const types: Record<string, string> = {
	".html": `text/html`,
	".js": `application/javascript`,
	".css": `text/css`,
	".json": `application/json`,
	".svg": `image/svg+xml`,
	".png": `image/png`,
	".otf": `font/otf`,
}
const server = createServer(async (req, res) => {
	const pathname = new URL(req.url ?? `/`, `http://localhost`).pathname
	// Chrome requests the conventional favicon before Storybook's manager mounts.
	if (pathname === `/favicon.ico`) {
		res.writeHead(302, { Location: `/favicon.svg` }).end()
		return
	}
	const path = resolve(
		storybook,
		`.${decodeURIComponent(pathname === `/` ? `/index.html` : pathname)}`,
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
await new Promise<void>((ready) => server.listen(0, `127.0.0.1`, ready))
let browser: Browser | undefined
let activePage: Page | undefined
let activeContext: BrowserContext | undefined
let activeProfile: string | undefined
const profiles = []
const provenance = {
	candidate: process.env[`SPA_DEVTOOLS_CANDIDATE_SHA`] ?? `working-tree`,
	pullRequestHead: process.env[`SPA_DEVTOOLS_PR_HEAD_SHA`] ?? null,
	testedRevision: process.env[`GITHUB_SHA`] ?? null,
	mode: `static`,
	developmentServer: false,
	hmr: false,
	storybook,
}
// Wait for Storybook's render lifecycle so the suite does not race the story's play function.
const finished = async (frame: Frame | Page, id: string) => {
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
	browser = await launchBrowser({ softwareWebGL: true })
	const address = server.address()
	assert.ok(address && typeof address !== `string`)
	const url = `http://127.0.0.1:${address.port}`
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
		// Explicit PNGs cover paint states without recording every animated logo frame.
		await context.tracing.start({ screenshots: false, snapshots: true })
		const page = await context.newPage()
		const errors: string[] = []
		const assetFailures: { url: string; status: number }[] = []
		activePage = page
		page.on(`pageerror`, (error) => errors.push(error.message))
		// Storybook reports play failures through console errors even when its render
		// lifecycle reaches "finished". Do not silently accept those transitions.
		page.on(`console`, (message) => {
			if (message.type() === `error`) errors.push(message.text())
		})
		page.on(`response`, (response) => {
			if (
				response.status() >= 400 &&
				/\.(?:js|css|woff2?|otf|png|svg)(?:\?|$)/.test(response.url())
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
					?.ownerDocument === document,
			overflow: document.documentElement.scrollWidth > innerWidth,
		}))
		assert.equal(layout.debuggerDocument, true)
		assert.equal(layout.overflow, false)
		assert.equal(
			await page
				.getByRole(`main`, { name: `Order fulfillment application` })
				.count(),
			1,
		)
		assert.equal(await page.locator(`order-fulfillment > details`).count(), 0)
		assert.equal(
			await page
				.locator(`order-fulfillment`)
				.evaluate((node) => getComputedStyle(node).zIndex),
			`auto`,
		)
		const storefront = page.locator(`order-summary`)
		const debuggerVisible = async (visible: boolean) => {
			if ((await page.getByTestId(`atom-io-devtools`).isVisible()) !== visible) {
				if (visible) await page.keyboard.press(`Control+Shift+A`)
				else
					await page
						.getByRole(`button`, {
							name: `Hide debugger (Ctrl+Shift+A)`,
							exact: true,
						})
						.click()
			}
		}
		const checkControls = async () => {
			await debuggerVisible(false)
			const secondary = storefront.locator(`:scope > details`)
			if (!(await secondary.evaluate((node: HTMLDetailsElement) => node.open)))
				await secondary.locator(`:scope > summary`).click()
			for (const button of await storefront.locator(`button`).all()) {
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
			await debuggerVisible(true)
		}
		await checkControls()
		for (const colorScheme of [`light`, `dark`] as const) {
			await page.emulateMedia({ colorScheme })
			await debuggerVisible(false)
			await page.evaluate(async () => {
				await document.fonts.ready
			})
			await storefront.locator(`:scope > store-intro`).scrollIntoViewIfNeeded()
			await page.screenshot({
				path: resolve(activeProfile, `${colorScheme}-storefront.png`),
			})
			await storefront
				.getByRole(`heading`, { name: /^Your cart/ })
				.evaluate((node) => {
					node.scrollIntoView({ block: `start` })
				})
			await page.screenshot({
				path: resolve(activeProfile, `${colorScheme}-cart.png`),
			})
			await storefront
				.getByLabel(`Order total`, { exact: true })
				.evaluate((node) => {
					node.scrollIntoView({ block: `center` })
				})
			await page.screenshot({
				path: resolve(activeProfile, `${colorScheme}-cart-total.png`),
			})
			await storefront
				.getByRole(`heading`, { name: /^On the shelves/ })
				.evaluate((node) => {
					node.scrollIntoView({ block: `start` })
				})
			await page.screenshot({
				path: resolve(activeProfile, `${colorScheme}-catalog.png`),
			})
			assert.equal(
				await storefront.evaluate((node) => node.scrollWidth > node.clientWidth),
				false,
			)
			await debuggerVisible(true)
		}
		const ecology = page.getByTestId(`ecology-view`)
		const ready = () =>
			page.waitForFunction(
				() =>
					document.querySelector<HTMLElement>(`ecology-view`)?.dataset[
						`ready`
					] === `true`,
			)
		await ready()
		await ecology.locator(`ecology-scene`).waitFor({ state: `visible` })
		const snapshot = await ecology.getAttribute(`data-snapshot-ms`)

		assert.equal(await ecology.locator(`ecology-scene`).isVisible(), true)

		assert.equal(await ecology.locator(`ecology-editor`).isVisible(), true)
		const input = ecology.getByRole(`searchbox`, { name: `Search ecology` })
		const openSearch = async () => {
			if (!(await input.isVisible()))
				await ecology.locator(`[data-action="search"]`).click()
		}
		await openSearch()
		await input.fill(`cartQuantityBySku("tea-green")`)
		await ready()
		await ecology
			.locator(`[data-results] button`)
			.filter({ hasText: `cartQuantityBySku("tea-green")` })
			.first()
			.click()
		await ready()
		assert.equal(await ecology.locator(`ecology-scene`).isVisible(), true)
		const editor = ecology.locator(
			`state-leaf[data-state-key='cartQuantityBySku("tea-green")'] input[inputmode="decimal"]`,
		)
		await editor.fill(`2e`)
		const summary = await page.getByTestId(`order-summary`).textContent()
		await openSearch()
		await input.fill(`availability`)
		await ready()
		assert.equal(await page.getByTestId(`order-summary`).textContent(), summary)
		const modalSearch = await input.evaluate((node) =>
			node.closest(`dialog`)!.matches(`:modal`),
		)
		await input.press(`Escape`)
		if (!modalSearch) {
			await ready()
			await input.press(`Escape`)
			await ready()
			await input.press(`Escape`)
		}
		assert.equal(
			await editor.evaluate((node) => node === document.activeElement),
			true,
		)
		assert.equal(await editor.inputValue(), `2e`)
		assert.equal(await ecology.getAttribute(`data-snapshot-ms`), snapshot)

		for (const colorScheme of [`light`, `dark`] as const) {
			await page.emulateMedia({ colorScheme })
			await page.screenshot({
				path: resolve(activeProfile, `${colorScheme}-selection.png`),
			})
			await page.screenshot({
				path: resolve(activeProfile, `${colorScheme}-node-list.png`),
			})
		}
		await page.screenshot({ path: resolve(activeProfile, `story-layout.png`) })
		// Real pointer capture and viewport geometry are built-output integration checks.
		const panel = page.getByTestId(`atom-io-devtools`)
		const beforeGesture = await panel.boundingBox()
		const corner = await page.locator(`[data-resize="nw"]`).boundingBox()
		assert.ok(beforeGesture && corner)
		await page.mouse.move(
			corner.x + corner.width / 2,
			corner.y + corner.height / 2,
		)
		await page.mouse.down()
		await page.mouse.move(corner.x + 40, corner.y + 80, { steps: 6 })
		await page.mouse.up()
		const resized = await panel.boundingBox()
		assert.ok(resized)
		assert.ok(resized.height < beforeGesture.height)
		const handle = await page
			.getByRole(`button`, { name: `Move debugger`, exact: true })
			.boundingBox()
		assert.ok(handle)
		await page.mouse.move(
			handle.x + handle.width / 2,
			handle.y + handle.height / 2,
		)
		await page.mouse.down()
		await page.mouse.move(80, viewport.height / 2, { steps: 8 })
		await page.mouse.up()
		const moved = await panel.boundingBox()
		assert.ok(moved)
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
		const preview = await page
			.locator(`#storybook-preview-iframe`)
			.elementHandle()
		assert.ok(preview)
		const frame = await preview.contentFrame()
		assert.ok(frame)
		await preview.focus()
		await finished(frame, `atomiodevtools--primary`)
		assert.match(
			(await frame.locator(`ecology-view`).getAttribute(`data-counts`))!,
			/^11 atoms · 2 selectors/,
		)
		await frame.evaluate(() => {
			window.__orderStoryDocument = true
		})
		const navigation = page.getByRole(`button`, {
			name: `Open navigation menu`,
			exact: true,
		})
		const mobileNavigation = await navigation.isVisible()
		if (mobileNavigation) await navigation.click()
		await page.locator(`a[href*="/story/${orderId}"]`).first().click()
		if (mobileNavigation)
			await page.getByRole(`button`, { name: /navigation menu/ }).press(`Escape`)
		// Native iframe focus is distinct from the play function's simulated input.
		// The mobile navigation menu returns focus to the manager when it closes.
		await preview.focus()
		await finished(frame, orderId)
		assert.equal(await frame.evaluate(() => window.__orderStoryDocument), true)
		const transitionCounts = await frame
			.locator(`ecology-view`)
			.getAttribute(`data-counts`)
		assert.match(transitionCounts!, /^94 atoms · 18 selectors/)
		assert.match(transitionCounts!, /51 captured edges/)
		// One reset is enough here to establish rebinding in the built manager.
		// Repeated reset behavior and root assertions belong to the play tests.
		for (const dismiss of await page
			.getByRole(`button`, { name: `Dismiss notification`, exact: true })
			.all())
			if (await dismiss.isVisible()) await dismiss.click()
		await frame
			.getByRole(`button`, { name: `Hide debugger (Ctrl+Shift+A)`, exact: true })
			.click()
		const managerSecondary = frame.locator(`order-summary > details`)
		if (
			!(await managerSecondary.evaluate((node: HTMLDetailsElement) => node.open))
		)
			await managerSecondary.locator(`:scope > summary`).click()
		const previousPanel = await frame
			.getByTestId(`atom-io-devtools`)
			.elementHandle()
		assert.ok(previousPanel)
		await frame
			.getByRole(`button`, { name: `Reset order scenario`, exact: true })
			.click()
		await frame.waitForFunction((element) => !element.isConnected, previousPanel)
		await frame.locator(`body`).press(`Control+Shift+A`)
		await frame.waitForFunction(
			() =>
				document.querySelector<HTMLElement>(`[data-testid="ecology-view"]`)
					?.dataset[`ready`] === `true`,
		)
		assert.equal(await frame.getByTestId(`atom-io-devtools`).count(), 1)
		assert.match(
			(await frame.locator(`ecology-view`).getAttribute(`data-counts`))!,
			/^94 atoms · 18 selectors/,
		)
		const uncachedRow = frame
			.getByRole(`button`, {
				name: /^Generate descriptiveOrderFulfillmentNote/,
			})
			.locator(`..`)
		const overflow = await uncachedRow.evaluate((row) => {
			const generate = row.querySelector<HTMLButtonElement>(
				`button[aria-label^="Generate "]`,
			)!
			return {
				row: row.scrollWidth > row.clientWidth,
				generate: generate.scrollWidth > generate.clientWidth,
			}
		})
		assert.deepEqual(overflow, { row: false, generate: false })
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
	await new Promise<void>((done) =>
		server.close(() => {
			done()
		}),
	)
}
