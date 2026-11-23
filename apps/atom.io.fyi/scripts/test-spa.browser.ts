declare global {
	interface Window {
		testNavigation: HTMLElement
		testLogo: HTMLElement
	}
}
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { extname, join, resolve } from "node:path"

import { dev } from "astro"
import { type Browser, chromium, type Locator } from "playwright"

async function assertTabAbovePane(tab: Locator, pane: Locator): Promise<void> {
	const tabBox = await tab.boundingBox()
	const paneBox = await pane.boundingBox()
	assert.ok(tabBox && paneBox)
	assert.ok(tabBox.y < paneBox.y)
	assert.ok(tabBox.x >= paneBox.x)
	assert.ok(tabBox.x + tabBox.width <= paneBox.x + paneBox.width)
}

const directory = resolve(import.meta.dirname, `../dist/client`)
const server = createServer(async (request, response) => {
	const pathname = decodeURIComponent(
		new URL(request.url ?? `/`, `http://localhost`).pathname,
	)
	const file = resolve(
		directory,
		`.${pathname}${extname(pathname) ? `` : `${pathname.endsWith(`/`) ? `` : `/`}index.html`}`,
	)
	if (!file.startsWith(`${directory}/`)) {
		response.writeHead(403).end()
		return
	}
	try {
		const data = await readFile(file)
		if (pathname.startsWith(`/_astro/`)) {
			response.setHeader(`access-control-allow-origin`, `*`)
		}
		response.setHeader(
			`content-type`,
			{
				".html": `text/html`,
				".js": `application/javascript`,
				".css": `text/css`,
			}[extname(file)] ?? `application/octet-stream`,
		)
		response.end(data)
	} catch {
		response.writeHead(404).end()
	}
})
let browser: Browser | undefined
let devServer: Awaited<ReturnType<typeof dev>> | undefined
let cacheDir: string | undefined
try {
	if (process.argv.includes(`--dev`)) {
		cacheDir = await mkdtemp(join(tmpdir(), `spa-site-dev-`))
		devServer = await dev({
			root: resolve(import.meta.dirname, `..`),
			server: { host: `127.0.0.1`, port: 0 },
			vite: { cacheDir },
			logLevel: `error`,
		})
	} else {
		await new Promise<void>((ready) => server.listen(0, `127.0.0.1`, ready))
	}
	browser = await chromium.launch({
		args: [`--enable-unsafe-swiftshader`],
		executablePath: process.env[`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`],
	})
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors: string[] = []
	const iframeRequests: string[] = []
	page.on(`request`, (request) => {
		if (request.isNavigationRequest() && request.frame().parentFrame()) {
			iframeRequests.push(request.url())
		}
	})
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
		console.error(error)
	})
	page.on(`console`, (message) => {
		if (message.type() === `error`) {
			errors.push(message.text())
			console.error(message.text())
		}
	})
	const base = `http://127.0.0.1:${devServer?.address.port ?? (server.address() as AddressInfo).port}`
	await page.context().grantPermissions([`clipboard-read`, `clipboard-write`])
	await page.goto(`${base}/docs/atom-io`)
	const exhibit = page.locator(`#use-a-selector-ts`)
	const code = exhibit.getByRole(`tab`, { name: `Code` })
	const ecology = exhibit.getByRole(`tab`, { name: `Ecology` })
	const frame = exhibit.frameLocator(`iframe`)
	const codePane = exhibit.locator(`pre`)
	const codeHeight = await codePane.evaluate((node) => {
		const style = getComputedStyle(node)
		const height = node.getBoundingClientRect().height
		const minimum =
			18 * 19 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
		return { height, minimum }
	})
	assert.ok(codeHeight.height >= codeHeight.minimum)
	assert.equal(await exhibit.locator(`iframe`).count(), 0)
	assert.equal(await code.getAttribute(`aria-selected`), `true`)
	await code.focus()
	await code.press(`ArrowRight`)
	assert.equal(await ecology.getAttribute(`aria-selected`), `true`)
	assert.equal(await codePane.isVisible(), false)
	assert.equal(
		(await exhibit.locator(`iframe`).boundingBox())?.height,
		codeHeight.height,
	)
	const quotient = frame.locator(`ecology-editor input[aria-label="quotient"]`)
	await quotient.waitFor()
	assert.equal(await quotient.inputValue(), `2`)
	assert.equal(
		await frame
			.locator(`ecology-panel`)
			.evaluate(
				(panel) => panel.getBoundingClientRect().height <= window.innerHeight,
			),
		true,
	)
	assert.equal(
		await frame.locator(`html`).evaluate(() => window.origin),
		devServer ? base : `null`,
	)
	await exhibit.getByRole(`button`, { name: `Copy code` }).click()
	await page.waitForFunction(
		async (expected) => (await navigator.clipboard.readText()) === expected,
		await exhibit.locator(`pre code`).textContent(),
	)

	const declaration = page.locator(`#declare-a-selector-ts`)
	const declarationHeight = (await declaration.locator(`pre`).boundingBox())!
		.height
	assert.ok(declarationHeight > codeHeight.height)
	await declaration.getByRole(`tab`, { name: `Ecology` }).click()
	assert.equal(
		(await declaration.locator(`iframe`).boundingBox())?.height,
		declarationHeight,
	)
	await declaration
		.frameLocator(`iframe`)
		.getByRole(`button`, { name: `Generate quotient`, exact: true })
		.waitFor()
	const namedSilo = page.locator(`#use-a-timeline-family-in-a-silo-ts`)
	await namedSilo.getByRole(`tab`, { name: `Ecology` }).click()
	await namedSilo
		.frameLocator(`iframe`)
		.locator(`ecology-editor button[data-graph-id="family:glyphName"]`)
		.waitFor()
	await ecology.focus()
	await ecology.press(`Home`)
	assert.equal(await exhibit.locator(`iframe`).count(), 1)
	assert.equal(await exhibit.locator(`iframe`).isVisible(), false)
	assert.equal(await code.getAttribute(`aria-selected`), `true`)
	assert.equal((await codePane.boundingBox())?.height, codeHeight.height)
	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(await ecology.locator(`span`).isVisible(), false)
	await page.setViewportSize({ width: 1440, height: 1000 })

	await page.goto(`${base}/docs/spa/motion`)
	const motionSetup = page.locator(`#motion-basic-main-tsx`)
	await motionSetup.getByRole(`tab`, { name: `Ecology` }).click()
	const motionFrame = motionSetup.frameLocator(`iframe`)
	await motionFrame
		.locator(`ecology-editor`)
		.getByRole(`button`, { name: `targetX`, exact: true })
		.waitFor()
	assert.equal(
		await motionFrame.locator(`#app p`).textContent(),
		`An animated paragraph.`,
	)
	assert.equal(await motionFrame.locator(`#app`).isVisible(), false)

	await page.goto(`${base}/docs/web`)
	const storage = page.locator(`#sync-with-local-storage-ts`)
	const storageEcology = storage.getByRole(`tab`, { name: `Ecology` })
	await storageEcology.click()
	const storageFrame = storage.frameLocator(`iframe`)
	const sidebar = storageFrame
		.locator(`ecology-editor`)
		.getByRole(`button`, { name: `sidebarOpen`, exact: true })
	await sidebar.waitFor()
	assert.equal(
		await storageFrame.locator(`html`).evaluate(() => {
			localStorage.setItem(`exhibit-test`, `local`)
			return sessionStorage.getItem(`exhibit-test`)
		}),
		null,
	)
	assert.equal(
		await page.evaluate(() => localStorage.getItem(`exhibit-test`)),
		null,
	)
	await storage.getByRole(`tab`, { name: `Code` }).click()
	await storageEcology.click()
	await sidebar.waitFor()
	assert.equal(
		await storageFrame
			.locator(`html`)
			.evaluate(() => localStorage.getItem(`exhibit-test`)),
		`local`,
	)

	assert.deepEqual(errors, [])
	console.log(`Exhibit ecology browser checks passed.`)

	await page.setViewportSize({ width: 1700, height: 1100 })
	await page.goto(`${base}/docs/atom-io`)
	const division = page.locator(`#edit-a-selector-tsx`)
	const divisionCode = division.getByRole(`tab`, { name: `Code` })
	const divisionEcology = division.getByRole(`tab`, { name: `Ecology` })
	const divisionPreview = division.getByRole(`tab`, { name: `Preview` })
	const divisionSource = division.locator(`pre`)
	const divisionFrame = division.frameLocator(`iframe`)
	const ecologyPane = divisionFrame.locator(`#ecology`)
	const previewPane = divisionFrame.locator(`#preview`)
	await page.locator(`#edit-a-selector-tsx[data-exhibit-layout="two"]`).waitFor()
	assert.equal(await division.locator(`iframe`).count(), 0)
	await division.scrollIntoViewIfNeeded()
	await ecologyPane.waitFor()
	assert.equal(await division.getAttribute(`data-exhibit-layout`), `two`)
	assert.equal(await previewPane.isVisible(), false)
	await assertTabAbovePane(divisionCode, divisionSource)
	await assertTabAbovePane(divisionEcology, ecologyPane)
	await assertTabAbovePane(divisionPreview, ecologyPane)

	await page.setViewportSize({ width: 2200, height: 1100 })
	await page.goto(`${base}/docs/atom-io`)
	await division.scrollIntoViewIfNeeded()
	const divisor = divisionFrame.locator(
		`ecology-editor input[aria-label="divisor"]`,
	)
	const previewDivisor = divisionFrame.getByText(`Divisor: 3`, { exact: true })
	const increaseDivisor = divisionFrame.getByRole(`button`, {
		name: `Increase divisor`,
	})
	await divisor.waitFor()
	await increaseDivisor.waitFor()
	assert.equal(await division.getAttribute(`data-exhibit-layout`), `three`)
	assert.equal(
		await page.locator(`#use-a-selector-ts`).getAttribute(`data-exhibit-layout`),
		`two`,
	)
	assert.equal(await divisor.inputValue(), `2`)
	await assertTabAbovePane(divisionCode, divisionSource)
	await assertTabAbovePane(divisionEcology, ecologyPane)
	await assertTabAbovePane(divisionPreview, previewPane)
	const sandbox = await division.locator(`iframe`).elementHandle()
	const liveDocument = (await sandbox.contentFrame())!
	await increaseDivisor.click()
	await previewDivisor.waitFor()
	await liveDocument.waitForFunction(
		() =>
			document.querySelector<HTMLInputElement>(
				`ecology-editor input[aria-label="divisor"]`,
			)?.value === `3`,
	)
	assert.equal(
		await divisionFrame.getByText(`Quotient: 4`, { exact: true }).isVisible(),
		true,
	)
	await divisionPreview.click()
	await divisionCode.click()
	assert.equal(await division.getAttribute(`data-exhibit-layout`), `three`)
	assert.ok(await previewPane.isVisible())
	assert.ok(await ecologyPane.isVisible())

	await page.setViewportSize({ width: 1700, height: 1000 })
	await divisionFrame.locator(`#ecology`).waitFor({ state: `hidden` })
	assert.equal(await division.getAttribute(`data-exhibit-layout`), `two`)
	assert.ok(await division.locator(`pre`).isVisible())
	await divisionEcology.click()
	await divisor.waitFor()
	assert.equal(await divisor.inputValue(), `3`)
	assert.equal(await previewPane.isVisible(), false)
	await divisionCode.click()
	assert.equal(await division.getAttribute(`data-exhibit-layout`), `two`)
	assert.equal(await divisor.inputValue(), `3`)
	await divisionEcology.click()

	await page.setViewportSize({ width: 1440, height: 1000 })
	await divisionSource.waitFor({ state: `hidden` })
	assert.equal(await division.getAttribute(`data-exhibit-layout`), `one`)
	await divisionCode.click()
	assert.equal(await division.locator(`iframe`).isVisible(), false)
	await divisionPreview.click()
	await previewDivisor.waitFor()
	assert.equal(await division.locator(`iframe`).count(), 1)
	assert.equal(await sandbox.evaluate((node) => node.isConnected), true)
	console.log(`Shared exhibit store and responsive layout checks passed.`)

	await page.goto(`${base}/docs/react`)
	const counter = page.locator(`#counter-preview-tsx`)
	assert.deepEqual(
		await counter
			.getByRole(`tab`)
			.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute(`aria-label`))),
		[`Code`, `Ecology`, `Preview`],
	)
	assert.equal(await counter.locator(`iframe`).count(), 0)
	const counterHeight = (await counter.boundingBox())!.height
	await counter.getByRole(`tab`, { name: `Code` }).press(`End`)
	const preview = counter.frameLocator(`iframe`)
	const count = preview.getByRole(`spinbutton`, { name: `Count` })
	assert.equal(await count.inputValue(), `0`)
	const desktopColor = await preview
		.locator(`#preview`)
		.evaluate((node) => getComputedStyle(node).backgroundColor)
	const tabColors = await counter
		.getByRole(`tab`, { name: `Preview` })
		.evaluate((tab) => {
			const { backgroundColor, borderBottomColor } = getComputedStyle(tab)
			return [backgroundColor, borderBottomColor]
		})
	assert.deepEqual(tabColors, [desktopColor, desktopColor])
	await preview.getByRole(`button`, { name: `Add`, exact: true }).click()
	assert.equal(await count.inputValue(), `1`)
	assert.equal(
		await count.evaluate((input) => getComputedStyle(input).backgroundColor),
		`rgb(255, 255, 255)`,
	)
	assert.equal((await counter.boundingBox())?.height, counterHeight)
	await counter.getByRole(`tab`, { name: `Code` }).click()
	assert.equal(await counter.locator(`iframe`).count(), 1)
	assert.equal(await counter.locator(`iframe`).isVisible(), false)
	await counter.getByRole(`tab`, { name: `Preview` }).click()
	assert.equal(await count.inputValue(), `1`)

	const workspace = page.locator(`#silo-store-providers-tsx`)
	await workspace.getByRole(`tab`, { name: `Ecology` }).click()
	await workspace
		.frameLocator(`iframe`)
		.locator(`ecology-editor`)
		.getByRole(`button`, { name: `title`, exact: true })
		.waitFor()
	await workspace.getByRole(`tab`, { name: `Preview` }).click()
	const documentPreview = workspace.frameLocator(`iframe`)
	const leftTitle = documentPreview.getByRole(`textbox`, {
		name: `left-document title`,
	})
	const rightTitle = documentPreview.getByRole(`textbox`, {
		name: `right-document title`,
	})
	await leftTitle.fill(`Edited title`)
	assert.equal(await leftTitle.inputValue(), `Edited title`)
	assert.equal(await rightTitle.inputValue(), `Untitled`)
	await workspace.getByRole(`tab`, { name: `Ecology` }).click()
	const graphTitle = documentPreview.locator(
		`ecology-editor input[aria-label="title"]`,
	)
	await graphTitle.waitFor()
	assert.equal(await graphTitle.inputValue(), `Edited title`)
	assert.deepEqual(errors, [])
	console.log(`Exhibit React preview browser checks passed.`)

	await page.goto(`${base}/docs/spa/vite`)
	const spaCounter = page.locator(`#counter-tsx`)
	await spaCounter.getByRole(`tab`, { name: `Preview` }).click()
	const spaPreview = spaCounter.frameLocator(`iframe`)
	await spaPreview.getByRole(`button`, { name: `Count: 0` }).click()
	await spaPreview.getByRole(`button`, { name: `Count: 1` }).waitFor()
	await spaCounter.getByRole(`tab`, { name: `Code` }).click()
	assert.equal(await spaCounter.locator(`iframe`).count(), 1)
	assert.equal(await spaCounter.locator(`iframe`).isVisible(), false)

	await page.goto(`${base}/docs/solid`)
	const solidCounter = page.locator(`#counter-preview-tsx`)
	await solidCounter.getByRole(`tab`, { name: `Preview` }).click()
	const solidPreview = solidCounter.frameLocator(`iframe`)
	await solidPreview.getByText(`Count: 0`, { exact: true }).waitFor()
	await solidPreview.getByRole(`button`, { name: `Add` }).click()
	await solidPreview.getByText(`Count: 1`, { exact: true }).waitFor()
	await solidPreview.getByRole(`button`, { name: `Reset` }).click()
	await solidPreview.getByText(`Count: 0`, { exact: true }).waitFor()
	assert.deepEqual(errors, [])
	console.log(`Exhibit SPA and Solid preview browser checks passed.`)

	iframeRequests.length = 0
	await page.goto(`${base}/docs/getting-started`)
	assert.equal(await page.locator(`#install-sh [role="tab"]`).count(), 0)
	await page.waitForFunction(
		() =>
			document.querySelectorAll<HTMLElement>(`astro-island:not([ssr])`)
				.length === 3,
	)
	await page.waitForFunction(
		() => document.querySelectorAll<HTMLElement>(`on-this-page a`).length > 0,
	)
	assert.equal(
		await page.locator(`docs-navigation`).getAttribute(`data-pathname`),
		`/docs/getting-started`,
	)
	assert.equal(
		await page
			.locator(`code-block pre code`)
			.first()
			.textContent()
			.then((value) => Boolean(value?.length)),
		true,
	)
	const copiedCode = await page
		.locator(`code-block pre code`)
		.first()
		.textContent()
	await page.locator(`code-block > file-name > button`).first().click()
	await page.waitForFunction(
		async (expected) => (await navigator.clipboard.readText()) === expected,
		copiedCode,
	)
	await page.locator(`brand-mark[data-variant="mark"] canvas`).waitFor()
	await page.evaluate(() => {
		window.testNavigation =
			document.querySelector<HTMLElement>(`docs-navigation`)!
		window.testLogo = document.querySelector<HTMLElement>(
			`brand-mark[data-variant="mark"] canvas`,
		)!
	})
	await page.keyboard.press(`Control+Shift+A`)
	await page
		.locator(`[data-testid="atom-io-devtools"]`)
		.waitFor({ state: `visible` })
	const toggle = page.locator(`input[aria-label="menuToggle"]`)
	await toggle.check()
	await page.waitForFunction(
		() =>
			document
				.querySelector<HTMLElement>(`site-directory`)
				?.getAttribute(`data-user-has-toggled`) === `true`,
	)
	const panel = page.locator(`[data-testid="atom-io-devtools"]`)
	const debuggerContent = panel.locator(`debugger-content`)
	const readTypography = (element: Element) => {
		const { font, color } = getComputedStyle(element)
		return { font, color }
	}
	assert.deepEqual(
		await debuggerContent.evaluate(readTypography),
		await panel.evaluate(readTypography),
		`Debugger content must inherit the panel's font and color`,
	)
	await panel.getByRole(`tab`, { name: `atoms`, exact: true }).click()
	await page.locator(`button[aria-label="Expand headings"]`).click()
	await page.locator(`button[aria-label="Expand 0"]`).click()
	const rowHeights = await panel
		.locator(`state-leaf > json-editor > editor-row`)
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height))
	assert.ok(rowHeights.length >= 4)
	assert.ok(
		rowHeights.every((height) => height === 22),
		`State rows must retain the original 22px density: ${rowHeights.join(`, `)}`,
	)
	const nestedHeights = await panel
		.locator(`json-property > json-editor > editor-row`)
		.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height))
	assert.ok(nestedHeights.length > 20)
	assert.ok(
		nestedHeights.every((height) => height === 21),
		`Nested JSON rows must be 21px: ${nestedHeights.join(`, `)}`,
	)
	assert.equal(
		await panel
			.locator(`debugger-toolbar`)
			.evaluate(
				(element: HTMLElement) => element.getBoundingClientRect().height,
			),
		66,
		`The title and tab rows occupy 66px including toolbar padding`,
	)
	await page.emulateMedia({ colorScheme: `dark` })
	assert.equal(
		await debuggerContent.evaluate(
			(element: HTMLElement) => getComputedStyle(element).backgroundColor,
		),
		`color(srgb 0.0666667 0.0666667 0.0666667 / 0.92)`,
	)
	await panel.screenshot({ path: `/tmp/devtools-dense-dark.png` })
	await page.emulateMedia({ colorScheme: `light` })
	assert.equal(
		await debuggerContent.evaluate(
			(element: HTMLElement) => getComputedStyle(element).backgroundColor,
		),
		`color(srgb 0.976471 0.976471 0.976471 / 0.92)`,
	)
	await panel.screenshot({ path: `/tmp/devtools-dense-light.png` })
	const initialPanel = await panel.boundingBox()
	assert.ok(initialPanel)
	const waitForOffset = (dx: number, dy: number) =>
		page.waitForFunction(
			([x, y]) => {
				const rect = document
					.querySelector<HTMLElement>(`[data-testid="atom-io-devtools"]`)!
					.getBoundingClientRect()
				return Math.abs(rect.x - x) < 1 && Math.abs(rect.y - y) < 1
			},
			[initialPanel.x + dx, initialPanel.y + dy],
		)
	const handle = page.locator(`button[aria-label="Move debugger"]`)
	const bounds = await handle.boundingBox()
	if (!bounds) throw new Error(`Missing bounds`)
	await page.mouse.move(
		bounds.x + bounds.width / 2,
		bounds.y + bounds.height / 2,
	)
	await page.mouse.down()
	await page.mouse.move(
		bounds.x + bounds.width / 2 - 40,
		bounds.y + bounds.height / 2 - 30,
		{ steps: 4 },
	)
	await page.mouse.up()
	await waitForOffset(-40, -30)
	await handle.focus()
	await page.keyboard.press(`ArrowLeft`)
	await waitForOffset(-50, -30)

	await page.screenshot({
		path: `/tmp/spa-site-desktop.png`,
		fullPage: false,
	})
	await page.keyboard.press(`Control+Shift+A`)
	await page.locator(`site-directory a[href="/docs/concepts"]`).click()
	await page.waitForURL(`**/docs/concepts`)
	await page.waitForFunction(
		() =>
			document
				.querySelector<HTMLElement>(`docs-navigation`)
				?.getAttribute(`data-pathname`) === `/docs/concepts`,
	)
	assert.equal(
		await page.evaluate(
			() =>
				window.testNavigation ===
				document.querySelector<HTMLElement>(`docs-navigation`)!,
		),
		true,
	)
	assert.equal(
		await page.evaluate(
			() =>
				window.testLogo ===
				document.querySelector<HTMLElement>(
					`brand-mark[data-variant="mark"] canvas`,
				)!,
		),
		true,
	)
	await page.waitForFunction(
		() =>
			document.querySelector<HTMLElement>(`on-this-page a`)?.textContent !== ``,
	)
	await page.keyboard.press(`Control+Shift+A`)
	await toggle.uncheck()
	await page.keyboard.press(`Control+Shift+A`)
	await page.setViewportSize({ width: 390, height: 844 })
	await page.locator(`menu-toggle button`).click()
	await page.waitForFunction(
		() =>
			document
				.querySelector<HTMLElement>(`site-directory`)
				?.getAttribute(`data-user-has-toggled`) === `true`,
	)
	await page.screenshot({
		path: `/tmp/spa-site-mobile.png`,
		fullPage: false,
	})
	await page.locator(`app-shell > header a[href="/"]`).click()
	await page.waitForURL(`${base}/`)
	await page.waitForFunction(
		() => document.querySelectorAll(`brand-mark canvas`).length === 2,
	)
	await page.locator(`app-shell > header a[href="/docs"]`).click()
	await page.waitForURL(`${base}/docs`)
	await page.waitForFunction(
		() =>
			document
				.querySelector<HTMLElement>(`docs-navigation`)
				?.getAttribute(`data-pathname`) === `/docs`,
	)
	assert.equal(
		await page.evaluate(
			() =>
				window.testNavigation ===
				document.querySelector<HTMLElement>(`docs-navigation`)!,
		),
		false,
	)
	assert.equal(
		await page.evaluate(
			() =>
				window.testLogo ===
				document.querySelector<HTMLElement>(
					`brand-mark[data-variant="mark"] canvas`,
				)!,
		),
		true,
	)
	await page.reload()
	await page.waitForFunction(
		() =>
			document.querySelectorAll<HTMLElement>(`astro-island:not([ssr])`)
				.length === 3,
	)
	assert.deepEqual(errors, [])
	assert.deepEqual(
		iframeRequests,
		[],
		`Navigation must not mount hidden copies of the page`,
	)
	console.log(
		`Site browser checks passed: compact rows and themes, hydration, code copying, shared-store editing, pointer dragging, persisted navigation, mobile menu, Three.js lifecycle, fresh navigation, reload.`,
	)
} finally {
	await browser?.close()
	if (devServer) await devServer.stop()
	if (server.listening)
		await new Promise<void>((done) =>
			server.close(() => {
				done()
			}),
		)
	if (cacheDir) await rm(cacheDir, { recursive: true, force: true })
}
