import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { arch, cpus, platform } from "node:os"
import { resolve as resolvePath } from "node:path"

import { build } from "esbuild"
import type { Browser } from "playwright"
import { Color } from "three"

import {
	browserArtifacts,
	cpuRate,
	launchBrowser,
	loadDevtoolsAssets,
	performancePolicy,
	reportPerformanceTarget,
	strictPerformance,
} from "./browser-runtime.ts"

const artifacts = browserArtifacts(
	process.env[`SPA_DEVTOOLS_ECOLOGY_ARTIFACTS`] ?? `/tmp/spa-devtools-ecology`,
)
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
const assets = await loadDevtoolsAssets()
const server = createServer((request, response) => {
	const pathname = new URL(request.url ?? `/`, `http://localhost`).pathname
	const asset = assets.get(pathname)
	if (asset) {
		response.setHeader(`content-type`, asset.type)
		response.end(asset.body)
		return
	}

	response.setHeader(
		`content-type`,
		request.url === `/app.js` ? `application/javascript` : `text/html`,
	)
	response.end(
		request.url === `/app.js`
			? bundle.outputFiles[0].text
			: `<link rel="stylesheet" href="/devtools.css"><script type="module" src="/app.js"></script>`,
	)
})
await new Promise<void>((ready) => server.listen(0, `127.0.0.1`, ready))
let browser: Browser | undefined
try {
	browser = await launchBrowser({ softwareWebGL: true })
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		colorScheme: `dark`,
		hasTouch: true,
	})
	if (!strictPerformance)
		await context.tracing.start({ screenshots: true, snapshots: true })
	const page = await context.newPage(),
		errors: string[] = []
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
		process.stderr.write(`${error.stack}\n`)
	})
	await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
	const ready = async () => {
		await page.waitForFunction(
			() =>
				document.querySelector<HTMLElement>(`ecology-view`)?.dataset[`ready`] ===
				`true`,
		)
	}
	const choose = async (id: string) => {
		await page
			.locator(`ecology-node-card > button[data-graph-id]`)
			.evaluateAll((nodes, target) => {
				const node = nodes.find((item) => item.dataset[`graphId`] === target)
				if (!node) throw new Error(`Missing node`)
				assertPresent(node)
				;(node as HTMLButtonElement).focus({ preventScroll: true })
				node.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
				function assertPresent(value: unknown): asserts value {
					if (!value) throw new Error(`Missing graph node ${target}`)
				}
			}, id)
		await ready()
	}
	await ready()

	const showDetails = async () => {
		const details = page.locator(
			`ecology-editor-row[data-section="selected"] [data-node-details]`,
		)
		if (!(await details.evaluate((node: HTMLDetailsElement) => node.open)))
			await details.locator(`summary`).click()
	}
	const palette = async () => {
		const cards = await page
			.locator(`ecology-node-card:not([hidden])`)
			.evaluateAll((nodes) =>
				nodes.map((node) => ({
					id: node.querySelector<HTMLElement>(`button`)!.dataset[`graphId`],
					color: getComputedStyle(node)
						.getPropertyValue(`--ecology-color`)
						.trim(),
					border: getComputedStyle(node.querySelector(`button`)!).borderTopColor,
				})),
			)
		for (const card of cards)
			assert.equal(
				card.border.replaceAll(` `, ``),
				new Color(card.color).getStyle(),
				`Border must retain its key color: ${card.id}`,
			)
		return cards
	}
	for (const colorScheme of [`light`, `dark`] as const) {
		await page.emulateMedia({ colorScheme })
		const cards = await palette()
		assert.equal(new Set(cards.map((card) => card.color)).size, cards.length)
	}
	assert.equal(await page.locator(`ecology-view nav[data-workspace]`).count(), 0)
	assert.equal(
		await page
			.locator(
				`ecology-map > nav, ecology-view p[data-counts], ecology-scene > p`,
			)
			.count(),
		0,
	)
	const guideButton = page.getByRole(`button`, {
		name: `Ecology guide`,
		exact: true,
	})
	const guideDialog = page.locator(`[data-guide-modal]`)
	await guideButton.click()
	assert.equal(
		await guideDialog.evaluate((node) => node.matches(`:modal`)),
		true,
	)
	assert.match(await guideDialog.innerText(), /Capture details & legend/)
	await page.keyboard.press(`Escape`)
	assert.equal(
		await guideButton.evaluate((node) => node === document.activeElement),
		true,
	)
	const scene = page.locator(`ecology-scene`)
	const cylinderFits = async () => {
		await page.waitForFunction(() => {
			const node = document.querySelector<HTMLElement>(`ecology-scene`)!
			const [diameter, height] = node.dataset[`cylinder`]!.split(`,`).map(Number)
			const box = node.getBoundingClientRect()
			return Math.abs(diameter / height - box.width / box.height) < 0.00001
		})
	}
	await cylinderFits()
	await page.waitForFunction(() =>
		Boolean(
			document.querySelector<HTMLElement>(`ecology-scene`)!.dataset[`camera`],
		),
	)
	assert.equal(await scene.getAttribute(`data-unavailable`), `false`)
	const camera = () => scene.getAttribute(`data-camera`)
	const pose = await camera(),
		bounds = (await scene.boundingBox())!
	await page.mouse.move(bounds.x + 15, bounds.y + 15)
	await page.mouse.down()
	await page.mouse.move(bounds.x + 65, bounds.y + 40, { steps: 5 })
	await page.mouse.up()
	assert.notEqual(await camera(), pose, `Mouse drag must orbit`)
	const orbited = await camera()
	await page.mouse.down({ button: `right` })
	await page.mouse.move(bounds.x + 110, bounds.y + 70, { steps: 5 })
	await page.mouse.up({ button: `right` })
	assert.notEqual(await camera(), orbited, `Right drag must pan`)
	const panned = await camera()
	await page.mouse.wheel(0, -160)
	await page.waitForFunction(
		(previous) =>
			document.querySelector<HTMLElement>(`ecology-scene`)!.dataset[`camera`] !==
			previous,
		panned,
	)
	const transforms = await page
		.locator(`ecology-node-card`)
		.evaluateAll((cards) =>
			cards
				.filter((card) => (card as HTMLElement).style.display !== `none`)
				.map((card) => (card as HTMLElement).style.transform),
		)
	assert.ok(
		transforms.every(
			(transform) =>
				transform.includes(`translate`) &&
				!/rotate\((?!0rad)|matrix3d/.test(transform),
		),
		`DOM cards must face the viewer`,
	)
	await page.getByRole(`button`, { name: `Reset view`, exact: true }).click()
	const before = await page.evaluate(() => window.ecologyFixture.evidence())
	await page.getByRole(`searchbox`, { name: `Search ecology` }).fill(`dormant`)
	await ready()
	assert.equal(
		(await scene.boundingBox())!.height,
		bounds.height,
		`Desktop results must not resize the graph`,
	)

	await page
		.locator(`ecology-editor-row:not([hidden]) button[data-graph-id]`)
		.first()
		.focus()
	await page.keyboard.press(`Enter`)
	await ready()
	assert.match(await page.locator(`ecology-editor`).innerText(), /dormant/)
	await showDetails()
	await page
		.getByRole(`button`, { name: `Trace observed roots`, exact: true })
		.focus()
	await page.keyboard.press(`Enter`)
	await ready()
	assert.equal(
		await page.evaluate(() => document.activeElement!.textContent),
		`Trace observed roots`,
	)

	assert.match(await page.locator(`ecology-editor`).innerText(), /incomplete/)
	const rankedInput = page.getByRole(`searchbox`, { name: `Search ecology` })
	const captured = await page
		.locator(`ecology-view`)
		.getAttribute(`data-snapshot-ms`)
	await scene.focus()
	await page.keyboard.press(`ArrowRight`)
	const pan = await page.locator(`ecology-scene`).getAttribute(`data-camera`)
	await rankedInput.fill(`ｄｏｒｍａｎｔ`)
	await ready()
	assert.equal(
		await page
			.locator(`ecology-view [data-results] button`)
			.first()
			.getAttribute(`aria-label`),
		`dormant`,
	)
	await rankedInput.fill(`items a`)
	await ready()
	await page
		.locator(`ecology-view [data-results]`)
		.getByRole(`button`, { name: `items("a")`, exact: true })
		.click()
	await ready()
	assert.equal(
		await page.evaluate(
			() => (document.activeElement as HTMLElement).dataset[`graphId`],
		),
		`state:items("a")`,
	)
	for (const expected of [`family:items`, `state:items("a")`]) {
		await page.keyboard.press(`Enter`)
		await ready()
		assert.equal(
			await page.evaluate(
				() => (document.activeElement as HTMLElement).dataset[`graphId`],
			),
			`state:items("a")`,
		)
		assert.equal(
			await page
				.locator(
					`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
				)
				.innerText(),
			`items("a")`,
		)
		assert.equal(
			await page
				.locator(`ecology-node-card > button[aria-pressed="true"]`)
				.getAttribute(`data-graph-id`),
			expected,
		)
	}
	await page.keyboard.press(`Escape`)
	assert.equal(
		await rankedInput.evaluate((node) => node === document.activeElement),
		true,
	)
	assert.notEqual(
		await page.locator(`ecology-scene`).getAttribute(`data-camera`),
		pan,
	)
	assert.equal(
		await page.locator(`ecology-view`).getAttribute(`data-snapshot-ms`),
		captured,
	)
	await page.getByRole(`button`, { name: `Reset view`, exact: true }).click()
	await page.getByRole(`searchbox`, { name: `Search ecology` }).fill(``)
	await ready()
	await choose(`family:items`)
	await showDetails()
	await page
		.getByRole(`button`, { name: `Collapse family`, exact: true })
		.click()
	await ready()
	await scene.focus()
	await page.keyboard.press(`Enter`)
	await ready()
	assert.equal(
		await page
			.getByRole(`button`, { name: `Collapse family`, exact: true })
			.count(),
		1,
	)
	await page.keyboard.press(`Enter`)
	await ready()
	assert.equal(
		await page
			.getByRole(`button`, { name: `Expand family`, exact: true })
			.count(),
		1,
	)
	await page.keyboard.press(`Enter`)
	await ready()
	await page
		.getByRole(`button`, { name: `Collapse family`, exact: true })
		.click()
	await ready()
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
	await page.waitForFunction(() => {
		const cards = [
			...document.querySelectorAll<HTMLElement>(
				`ecology-node-card:not([hidden])`,
			),
		]
		const active = cards.filter((node) => node.dataset[`traced`] === `true`)
		const inactive = cards.filter((node) => node.dataset[`traced`] !== `true`)
		const selected = cards.find((node) =>
			node.querySelector(`[aria-pressed="true"]`),
		)!
		return (
			Math.min(...active.map((node) => Number(node.style.zIndex))) >
				Math.max(...inactive.map((node) => Number(node.style.zIndex))) &&
			Number(selected.style.zIndex) ===
				Math.max(...cards.map((node) => Number(node.style.zIndex)))
		)
	})
	assert.deepEqual(
		await page
			.locator(`ecology-node-card[data-traced="true"] > button`)
			.evaluateAll((nodes) =>
				nodes.map((node) => (node as HTMLElement).dataset[`graphId`]).sort(),
			),
		[`state:price`, `state:total`],
	)
	await palette()
	assert.equal(
		await page
			.locator(`ecology-node-card:has([data-graph-id="state:lazy"])`)
			.evaluate((node) => getComputedStyle(node).opacity),
		`0.5`,
	)
	await scene.focus()
	await page.keyboard.press(`Escape`)
	await ready()
	assert.equal(
		await page
			.locator(
				`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
			)
			.count(),
		0,
	)
	assert.equal(
		await page.locator(`ecology-node-card[data-dimmed="true"]`).count(),
		0,
	)
	await choose(`state:price`)
	assert.equal(
		await page
			.locator(`ecology-node-card:has([data-graph-id="state:total"])`)
			.getAttribute(`data-traced`),
		`true`,
	)
	await choose(`state:total`)
	await showDetails()
	await page
		.getByRole(`button`, { name: `Trace observed roots`, exact: true })
		.click()
	await ready()
	assert.match(await page.locator(`ecology-editor`).innerText(), /price/)
	await page.screenshot({ path: resolvePath(artifacts, `small-traced.png`) })
	const positions = await page
		.locator(`ecology-node-card > button[data-graph-id]`)
		.evaluateAll((nodes) =>
			nodes.map((node) => [
				node.dataset[`graphId`],
				node.closest(`ecology-node-card`)!.getAttribute(`data-position`),
			]),
		)
	await page.evaluate(() => {
		window.ecologyFixture.change()
	})
	await page.getByRole(`button`, { name: `Refresh`, exact: true }).click()
	await ready()
	assert.deepEqual(
		await page
			.locator(`ecology-node-card > button[data-graph-id]`)
			.evaluateAll((nodes) =>
				nodes.map((node) => [
					node.dataset[`graphId`],
					node.closest(`ecology-node-card`)!.getAttribute(`data-position`),
				]),
			),
		positions,
	)
	assert.equal(
		await page.locator(`ecology-view`).getAttribute(`data-new-positions`),
		`0`,
	)
	const jobs = await page.locator(`ecology-view`).getAttribute(`data-jobs`)
	await page
		.getByRole(`button`, { name: `Debugger layout`, exact: true })
		.click()
	await page
		.getByRole(`button`, { name: `Restore free position`, exact: true })
		.click()
	const beforeGeometry = await page
		.locator(`debugger-panel[data-css="spa-devtools"]`)
		.boundingBox()
	if (!beforeGeometry) throw new Error(`Missing beforeGeometry`)
	await page.getByRole(`button`, { name: `Move debugger`, exact: true }).focus()
	await page.keyboard.press(`ArrowLeft`)
	assert.equal(
		(await page
			.locator(`debugger-panel[data-css="spa-devtools"]`)
			.boundingBox())!.x,
		beforeGeometry.x - 10,
	)
	assert.equal(
		await page.locator(`ecology-view`).getAttribute(`data-jobs`),
		jobs,
	)
	await choose(`state:price`)
	const editor = page.locator(`ecology-editor input`).first()
	await editor.focus()
	await editor.fill(`1e`)
	const draftNode = await editor.elementHandle()
	await rankedInput.fill(`dormant`)
	await ready()
	await page.locator(`ecology-view [data-results] button`).first().click()
	await ready()
	assert.equal(await editor.inputValue(), `1e`)
	assert.equal(
		await editor.evaluate((node, original) => node === original, draftNode),
		true,
	)
	await rankedInput.focus()
	await rankedInput.press(`Escape`)
	await ready()
	await rankedInput.press(`Escape`)
	await ready()
	await rankedInput.press(`Escape`)
	assert.equal(
		await editor.evaluate((node) => node === document.activeElement),
		true,
	)
	await choose(`state:dormant`)
	await page
		.getByRole(`button`, {
			name: `Generate dormant`,
			exact: true,
		})
		.click()
	assert.equal(
		await page.evaluate(() => window.ecologyFixture.timings().reads),
		1,
	)
	await page
		.getByRole(`button`, { name: `Minimize debugger`, exact: true })
		.click()
	assert.equal(await page.locator(`ecology-view`).count(), 0)
	await page.getByRole(`button`, { name: `Open debugger`, exact: true }).click()
	await ready()
	await page.setViewportSize({ width: 390, height: 844 })

	await page.waitForFunction(() => {
		const editorElement = document.querySelector(`ecology-editor`)!,
			body = document.querySelector(`ecology-body`)!,
			sceneElement = document.querySelector(`ecology-scene`)!
		const box = editorElement.getBoundingClientRect(),
			parent = body.getBoundingClientRect()
		return (
			box.height <= parent.height * 0.4 + 1 &&
			sceneElement.getBoundingClientRect().bottom <= box.top + 1
		)
	})
	assert.equal(await scene.isVisible(), true)
	assert.equal(await page.locator(`ecology-editor`).isVisible(), true)
	await page.getByRole(`button`, { name: `Reset view`, exact: true }).click()
	await page.evaluate(() => new Promise(requestAnimationFrame))
	const tapTarget = await scene.evaluate((node) => {
		const sceneBounds = node.getBoundingClientRect()
		for (const button of node.querySelectorAll<HTMLButtonElement>(
			`ecology-node-card:not([hidden]) > button[data-graph-id]`,
		)) {
			const rect = button.getBoundingClientRect(),
				x = rect.x + rect.width / 2,
				y = rect.y + rect.height / 2
			if (
				x > sceneBounds.left &&
				x < sceneBounds.right &&
				y > sceneBounds.top &&
				y < sceneBounds.bottom &&
				document.elementFromPoint(x, y)?.closest(`button`) === button
			)
				return { x, y, id: button.dataset[`graphId`] }
		}
		return null
	})
	assert.ok(tapTarget, `A visible card must be reachable by touch`)
	const readsBeforeTap = await page.evaluate(
		() => window.ecologyFixture.timings().reads,
	)
	await page.touchscreen.tap(tapTarget.x, tapTarget.y)
	await ready()
	assert.equal(await scene.isVisible(), true)
	assert.equal(
		await page
			.locator(
				`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
			)
			.getAttribute(`data-graph-id`),
		tapTarget.id,
	)
	assert.equal(
		await page.evaluate(
			() => document.activeElement!.closest(`ecology-editor`) === null,
		),
		true,
	)
	assert.equal(
		await page.evaluate(() => window.ecologyFixture.timings().reads),
		readsBeforeTap,
	)
	await page.screenshot({ path: resolvePath(artifacts, `narrow.png`) })
	const searchTrigger = page.locator(`ecology-toolbar [data-action="search"]`)
	const searchModal = page.locator(`[data-search-modal]`)
	assert.equal(await rankedInput.isVisible(), false)
	// Modal layout and focus must be ready synchronously, before SPA publishes
	// aria-expanded: Storybook's keyboard interactions can begin in this turn.
	assert.equal(
		await page.evaluate(() => {
			const trigger = document.querySelector<HTMLButtonElement>(
				`ecology-toolbar [data-action="search"]`,
			)!
			trigger.focus()
			trigger.click()
			const searchInput =
				document.querySelector<HTMLInputElement>(`ecology-search input`)!
			return (
				document.activeElement === searchInput && searchInput.checkVisibility()
			)
		}),
		true,
	)
	assert.equal(
		await searchModal.evaluate((node) => node.matches(`:modal`)),
		true,
	)
	await rankedInput.fill(`price`)
	await ready()
	for (let tab = 0; tab < 8; tab++) {
		await page.keyboard.press(`Tab`)
		assert.equal(
			await searchModal.evaluate(
				(node) =>
					// Native modal Tab navigation may visit browser chrome, leaving body active.
					document.activeElement === document.body ||
					node.contains(document.activeElement),
			),
			true,
		)
	}
	await scene.focus()
	assert.equal(
		await scene.evaluate((node) => node === document.activeElement),
		false,
		`The modal makes background controls inert`,
	)
	await rankedInput.focus()
	await page.screenshot({ path: resolvePath(artifacts, `narrow-search.png`) })
	await page.keyboard.press(`Escape`)
	assert.equal(await searchTrigger.getAttribute(`data-filtered`), `true`)
	assert.equal(
		await searchTrigger.evaluate((node) => node === document.activeElement),
		true,
	)
	await searchTrigger.click()
	await page.getByRole(`button`, { name: `Clear search`, exact: true }).click()
	await ready()
	await page.getByRole(`button`, { name: `Close search`, exact: true }).click()
	assert.equal(await searchTrigger.getAttribute(`data-filtered`), `false`)
	await guideButton.click()
	const guideArticle = guideDialog.getByRole(`article`, {
		name: `Ecology user guide`,
	})
	assert.equal(
		await guideArticle.evaluate((node) => node.scrollHeight > node.clientHeight),
		true,
	)
	await guideArticle.evaluate((node) => {
		node.scrollTop = node.scrollHeight
	})
	await page.screenshot({ path: resolvePath(artifacts, `narrow-guide.png`) })
	await page.getByRole(`button`, { name: `Close guide`, exact: true }).click()
	const touch = await context.newCDPSession(page)
	// Start gestures on actual background, since cards move with layout and camera changes.
	const background = () =>
		scene.evaluate((node) => {
			const hitBounds = node.getBoundingClientRect(),
				points: { x: number; y: number }[] = []
			for (let y = hitBounds.y + 24; y < hitBounds.bottom - 60; y += 24)
				for (let x = hitBounds.x + 24; x < hitBounds.right - 60; x += 24)
					// Chromium adjusts touches near interactive cards to their buttons.
					// Choose clear background with room for the touch contact area.
					if (
						[-24, 0, 24].every((dx) =>
							[-24, 0, 24].every(
								(dy) => document.elementFromPoint(x + dx, y + dy) === node,
							),
						)
					)
						points.push({ x, y })
			return points
		})
	await cylinderFits()
	// ResizeObserver publishes canvas size before the next CSS2D render. Wait for
	// that render before choosing a background point for a real touch gesture.
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			),
	)
	const [orbitStart] = await background()
	assert.ok(orbitStart, `Graph must expose background for orbit controls`)
	const touchPose = await camera()
	await touch.send(`Input.dispatchTouchEvent`, {
		type: `touchStart`,
		touchPoints: [orbitStart],
	})
	await touch.send(`Input.dispatchTouchEvent`, {
		type: `touchMove`,
		touchPoints: [{ x: orbitStart.x + 40, y: orbitStart.y + 30 }],
	})
	await touch.send(`Input.dispatchTouchEvent`, {
		type: `touchEnd`,
		touchPoints: [],
	})
	assert.notEqual(await camera(), touchPose, `One finger must orbit`)
	await page.evaluate(() => new Promise(requestAnimationFrame))
	const clear = await background(),
		first = clear[0],
		second = clear.find(
			(point) => Math.hypot(point.x - first.x, point.y - first.y) >= 100,
		)
	assert.ok(second, `Graph must expose two background points for pinch controls`)
	const pinchPose = await camera()
	await touch.send(`Input.dispatchTouchEvent`, {
		type: `touchStart`,
		touchPoints: [
			{ ...first, id: 1 },
			{ ...second, id: 2 },
		],
	})
	await touch.send(`Input.dispatchTouchEvent`, {
		type: `touchMove`,
		touchPoints: [
			{ x: first.x - 16, y: first.y + 24, id: 1 },
			{ x: second.x + 40, y: second.y + 24, id: 2 },
		],
	})
	await touch.send(`Input.dispatchTouchEvent`, {
		type: `touchEnd`,
		touchPoints: [],
	})
	assert.notEqual(await camera(), pinchPose, `Two fingers must dolly and pan`)
	await page.setViewportSize({ width: 1440, height: 900 })
	await page.evaluate(() => {
		window.ecologyFixture.mount(`empty`)
	})
	await ready()
	await page.screenshot({ path: resolvePath(artifacts, `empty.png`) })
	assert.match(
		(await page.locator(`ecology-view`).getAttribute(`data-counts`))!,
		/0 atoms · 0 selectors/,
	)
	// Preserve DOM snapshots for the functional flows without walking the large
	// graph during timing. Renderer tracing below still records layout and paint.
	if (!strictPerformance) {
		await context.tracing.stop({
			path: resolvePath(artifacts, `functional-trace.zip`),
		})
		await context.tracing.start({ screenshots: false, snapshots: false })
	}
	const cdp = await context.newCDPSession(page)
	if (!strictPerformance)
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
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => {
					performance.mark(`s4-overview-observed`)
					resolve()
				}),
			),
	)
	const overview = await page.evaluate(() => ({
		overviewMs: performance.now() - window.ecologyFixture.timings().mountStarted,
		setupMs: window.ecologyFixture.timings().setupMs,
		...document.querySelector<HTMLElement>(`ecology-view`)!.dataset,
		maxChunkMs:
			document.querySelector<HTMLElement>(`ecology-view`)!.dataset[`maxChunkMs`],
		maxIndexChunkMs:
			document.querySelector<HTMLElement>(`ecology-view`)!.dataset[
				`maxIndexChunkMs`
			],
		maxMatchChunkMs:
			document.querySelector<HTMLElement>(`ecology-view`)!.dataset[
				`maxMatchChunkMs`
			],
		counts:
			document.querySelector<HTMLElement>(`ecology-view`)!.dataset[`counts`],
		notice: document.querySelector<HTMLElement>(`ecology-view [data-notice]`)!
			.textContent,
	}))
	assert.equal(
		await page.locator(`ecology-node-card > button[data-graph-id]`).count(),
		500,
	)
	await page.waitForFunction(
		() =>
			document.querySelector<HTMLElement>(`ecology-scene`)!.dataset[`edges`] ===
			`1000`,
	)
	await page.screenshot({ path: resolvePath(artifacts, `large.png`) })
	await page.evaluate(() => performance.mark(`s4-overview-end`))
	const search = [],
		selection = [],
		slices: number[] = [],
		stageSamples: Record<string, number>[] = [],
		timingSamples: Record<string, number>[] = []
	const warmupIterations = 5,
		sampleIterations = 20
	for (
		let iteration = 0;
		iteration < warmupIterations + sampleIterations;
		iteration++
	) {
		const index =
			iteration < warmupIterations ? iteration : iteration - warmupIterations
		const sample = await page.evaluate(
			async (key) => {
				const input = document.querySelector<HTMLInputElement>(
					`input[aria-label="Search ecology"]`,
				)!
				const start = performance.now()
				input.value = key
				input.dispatchEvent(new Event(`input`, { bubbles: true }))
				await new Promise<void>((resolve) => {
					const check = () => {
						if (
							document.querySelector<HTMLElement>(`ecology-view`)!.dataset[
								`ready`
							] === `true`
						)
							resolve()
						else setTimeout(check, 0)
					}
					check()
				})
				await new Promise(requestAnimationFrame)
				const searched = performance.now()
				document
					.querySelector<HTMLElement>(
						`ecology-node-card:not([data-collapsed="true"]) > button[data-graph-id]`,
					)!
					.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
				await new Promise(requestAnimationFrame)
				return {
					search: searched - start,
					selection: performance.now() - searched,
					timings: Object.fromEntries(
						[`matchMs`, `layoutMs`, `commitMs`].map((metric) => [
							metric,
							Number(
								document.querySelector<HTMLElement>(`ecology-view`)!.dataset[
									metric
								],
							),
						]),
					),
					stages: Object.fromEntries(
						[`maxIndexChunkMs`, `maxMatchChunkMs`, `maxChunkMs`].map(
							(metric) => [
								metric,
								Number(
									document.querySelector<HTMLElement>(`ecology-view`)!.dataset[
										metric
									],
								),
							],
						),
					),
				}
			},
			index % 5 === 0
				? ``
				: index % 5 === 1
					? `batch0`
					: `derived${index + 100}`,
		)
		if (iteration >= warmupIterations) {
			search.push(sample.search)
			selection.push(sample.selection)
			stageSamples.push(sample.stages)
			timingSamples.push(sample.timings)
			slices.push(Math.max(...Object.values(sample.stages)))
		}
	}
	assert.equal(
		await page.evaluate(() => window.ecologyFixture.timings().reads),
		0,
	)
	let rendererPaintMs: number | null = null,
		paintRecords: number | null = null
	if (!strictPerformance) {
		const stopped = new Promise<{ stream?: string }>((resolve) =>
			cdp.once(`Tracing.tracingComplete`, resolve),
		)
		await cdp.send(`Tracing.end`)
		const { stream } = await stopped
		assert.ok(stream)
		let trace = ``
		for (;;) {
			const chunk = await cdp.send(`IO.read`, { handle: stream })
			trace += chunk.data
			if (chunk.eof) break
		}
		await cdp.send(`IO.close`, { handle: stream })
		await writeFile(resolvePath(artifacts, `renderer-trace.json`), trace)
		const events = (
			JSON.parse(trace) as {
				traceEvents: { name: string; ts: number; dur?: number }[]
			}
		).traceEvents
		const startMark = events.find((event) => event.name === `s4-overview-start`),
			endMark = events.find((event) => event.name === `s4-overview-end`)
		assert.ok(startMark && endMark)
		const paints = events.filter(
			(event) =>
				event.name === `Paint` &&
				event.ts >= startMark.ts &&
				event.ts <= endMark.ts,
		)
		rendererPaintMs =
			paints.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1_000
		paintRecords = paints.length
	}
	const p95 = (values: number[]) =>
		[...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
	const report = {
		cpuRate,
		candidate: process.env[`SPA_DEVTOOLS_CANDIDATE_SHA`] ?? `working-tree`,
		browser: browser.version(),
		machine: `${platform()}/${arch()} ${cpus()[0]?.model}`,
		viewport: { width: 1440, height: 900 },
		fixture: { instances: 10_000, observedEdges: 30_000 },
		overview,
		tracing: !strictPerformance,
		rendererPaintMs,
		paintRecords,
		warmupIterations,
		sampleIterations,
		maxScheduledSliceMs: Math.max(...slices),
		stageSamples,
		timingSamples,
		searchMs: search,
		selectionMs: selection,
		searchP95Ms: p95(search),
		selectionP95Ms: p95(selection),
		proposedTargets: {
			overviewMs: 500,
			interactionP95Ms: 100,
			layoutChunkMs: 8,
		},
		performancePolicy,
		method: `Fresh-task DOM search/selection with first-frame observations, not hardware/compositor input latency. Snapshot, metadata indexing, matching and scheduled projection/layout slices, DOM commit and renderer Paint records reported separately. Large fixture construction excluded from overview and reported as setupMs. Full Playwright DOM snapshots cover functional flows; timed large-fixture work retains renderer tracing without DOM snapshot collection. S3 capture limits may truncate observations; notice/counts retained.`,
	}
	await writeFile(
		resolvePath(artifacts, `metrics.json`),
		JSON.stringify(report, null, 2),
	)
	process.stdout.write(JSON.stringify(report, null, 2) + `\n`)
	assert.deepEqual(errors, [])
	const maximumSlice = Math.max(
		Number(overview.maxChunkMs),
		Number(overview.maxIndexChunkMs),
		Number(overview.maxMatchChunkMs),
		report.maxScheduledSliceMs,
	)
	reportPerformanceTarget(`ecology layout chunk`, maximumSlice, 8)
	reportPerformanceTarget(`ecology overview`, overview.overviewMs, 500)
	reportPerformanceTarget(`ecology search p95`, report.searchP95Ms, 100)
	reportPerformanceTarget(`ecology selection p95`, report.selectionP95Ms, 100)
	const fallback = await context.newPage(),
		fallbackErrors: string[] = []
	fallback.on(`pageerror`, (error) => fallbackErrors.push(error.message))
	await fallback.addInitScript(() => {
		Object.defineProperty(HTMLCanvasElement.prototype, `getContext`, {
			value: () => null,
		})
	})
	await fallback.goto(
		`http://127.0.0.1:${(server.address() as AddressInfo).port}`,
	)
	await fallback.waitForSelector(
		`ecology-view[data-ready="true"] ecology-scene[data-unavailable="true"]`,
	)
	assert.match(
		await fallback.locator(`ecology-scene`).innerText(),
		/ecology editor/,
	)
	await fallback.screenshot({
		path: resolvePath(artifacts, `webgl-unavailable.png`),
	})
	await fallback.setViewportSize({ width: 390, height: 844 })
	await fallback
		.locator(`ecology-editor-row:not([hidden]) button[data-graph-id]`)
		.first()
		.click()
	await fallback.waitForFunction(
		() =>
			document.querySelector<HTMLElement>(`ecology-view`)?.dataset[`ready`] ===
			`true`,
	)
	assert.equal(
		await fallback
			.getByRole(`button`, { name: `Generate dormant`, exact: true })
			.isVisible(),
		true,
	)
	assert.equal(
		await fallback
			.locator(`ecology-editor input[aria-label="price"]`)
			.isVisible(),
		true,
	)
	assert.equal(
		await fallback.evaluate(() => window.ecologyFixture.timings().reads),
		0,
	)
	assert.deepEqual(fallbackErrors, [])
	await fallback.screenshot({
		path: resolvePath(artifacts, `webgl-unavailable-narrow.png`),
	})
	await fallback.close()
	if (!strictPerformance)
		await context.tracing.stop({ path: resolvePath(artifacts, `trace.zip`) })
	await context.close()
} finally {
	await browser?.close()
	await new Promise<void>((done) =>
		server.close(() => {
			done()
		}),
	)
}
