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
	process.env[`SPA_DEVTOOLS_ECOLOGY_ARTIFACTS`] ?? `/tmp/devtools-ecology`,
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
		await context.tracing.start({ screenshots: false, snapshots: true })
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
			.locator(`ecology-node-card:not([inert]) > button[data-graph-id]`)
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

	const embedded = await context.newPage()
	await embedded.goto(
		`http://127.0.0.1:${(server.address() as AddressInfo).port}/?inline`,
	)
	await embedded.waitForSelector(`atom-io-ecology ecology-scene canvas`)
	const explorer = embedded.locator(`ecology-panel`)
	assert.equal(await embedded.locator(`debugger-panel`).count(), 0)
	assert.equal((await explorer.boundingBox())?.height, 500)
	assert.equal(
		await explorer
			.locator(`ecology-body`)
			.evaluate((body) => getComputedStyle(body).display),
		`grid`,
	)
	const prepareCompactSelection = async () => {
		// Establish the filtered baseline without an earlier pane animation in flight.
		await embedded.emulateMedia({ reducedMotion: `reduce` })
		await embedded.locator(`section`).evaluate((host) => {
			host.style.width = `480px`
		})
		await embedded.waitForFunction(
			() =>
				getComputedStyle(document.querySelector(`ecology-body`)!).display ===
				`flex`,
		)
		await explorer.locator(`[data-action="search"]`).click()
		assert.equal(await explorer.locator(`dialog:modal`).count(), 1)
		await explorer
			.getByRole(`searchbox`, { name: `Search ecology` })
			.fill(`price`)
		await explorer.locator(`[data-result-id="state:price"]`).waitFor()
		await explorer
			.getByRole(`button`, { name: `Close search`, exact: true })
			.click()
		await embedded.waitForFunction(() => {
			const view = document.querySelector<HTMLElement>(`ecology-view`)!
			const editor = view.querySelector<HTMLElement>(`ecology-editor`)!
			const rows = editor.querySelectorAll(`ecology-editor-row:not([hidden])`)
			return (
				view.dataset[`ready`] === `true` &&
				rows.length === 1 &&
				rows[0].getAttribute(`data-row-id`) === `state:price` &&
				!editor.style.getPropertyValue(`--ecology-editor-height`)
			)
		})
		await embedded.evaluate(async () => {
			await document.fonts.ready
		})
		await embedded.waitForSelector(`ecology-scene canvas`)
		await embedded.emulateMedia({ reducedMotion: `no-preference` })
		await embedded.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							resolve()
						})
					})
				}),
		)
	}
	for (const pane of [`ecology-map`, `ecology-editor`]) {
		if (pane === `ecology-editor`) await embedded.reload()
		await prepareCompactSelection()
		const { sizes, gridFrames } = await embedded.evaluate(async (source) => {
			const map = document.querySelector(`ecology-map`)!
			const editor = document.querySelector<HTMLElement>(`ecology-editor`)!
			const canvas = map.querySelector(`canvas`)!
			const sample = document.createElement(`canvas`)
			sample.width = sample.height = 64
			const pixels = sample.getContext(`2d`, { willReadFrequently: true })!
			const paintedFrames: boolean[] = []
			const read = () => [
				map.getBoundingClientRect().height,
				editor.getBoundingClientRect().height,
			]
			const frames = [read()]
			const button = document.querySelector<HTMLButtonElement>(
				`${source} button[data-graph-id="state:price"]`,
			)!
			await new Promise<void>((resolve) => {
				let animated = false
				const finish = () => {
					observer.disconnect()
					clearTimeout(timeout)
					frames.push(read())
					resolve()
				}
				const observer = new MutationObserver((records) => {
					if (records.some(({ target }) => target === canvas)) {
						pixels.clearRect(0, 0, 64, 64)
						pixels.drawImage(canvas, 0, 0, 64, 64)
						paintedFrames.push(
							pixels
								.getImageData(0, 0, 64, 64)
								.data.some((value, index) => index % 4 === 3 && value > 0),
						)
					}
					const running = Boolean(
						editor.style.getPropertyValue(`--ecology-editor-height`),
					)
					animated ||= running
					if (animated) frames.push(read())
					if (animated && !running) finish()
				})
				observer.observe(editor, { attributeFilter: [`style`] })
				observer.observe(canvas, { attributeFilter: [`width`, `height`] })
				const timeout = setTimeout(finish, 2000)
				button.focus({ preventScroll: true })
				button.click()
			})
			return { sizes: frames, gridFrames: paintedFrames }
		}, pane)
		const [startMap, startEditor] = sizes[0]
		const [endMap, endEditor] = sizes.at(-1)!
		assert.ok(
			endEditor > startEditor && endMap < startMap,
			`${pane} selection enlarges the editor (${JSON.stringify(sizes)})`,
		)
		assert.ok(
			sizes.some(
				([, height]) => height > startEditor + 1 && height < endEditor - 1,
			),
			`${pane} selection lays out intermediate sizes (${JSON.stringify(sizes)})`,
		)
		assert.ok(
			sizes.every(
				([mapHeight, editorHeight]) =>
					Math.abs(mapHeight + editorHeight - startMap - startEditor) < 1,
			),
			`Both panes share the same vertical space`,
		)
		assert.ok(
			gridFrames.length > 0 && gridFrames.every(Boolean),
			`${pane} selection keeps the floor grid visible on canvas resize (${JSON.stringify(gridFrames)})`,
		)
	}
	await embedded.close()

	const mapActions = page.locator(`ecology-map-actions`)
	const clearSelection = mapActions.getByRole(`button`, {
		name: `Clear selection`,
	})
	const expandFamily = mapActions.getByRole(`button`, { name: `Expand family` })
	const collapseFamily = mapActions.getByRole(`button`, {
		name: `Collapse family`,
	})
	const checkDepth = (sign: -1 | 1) =>
		page.waitForFunction((direction) => {
			const button = document.querySelector(
				`ecology-map-actions [data-action="clear"]`,
			)
			if (!button) return false
			const transform = getComputedStyle(button).transform
			if (transform === `none`) return false
			const matrix = new DOMMatrixReadOnly(transform)
			return (
				direction * matrix.m43 > 12 &&
				Math.abs(matrix.m13) > 0.1 &&
				Math.abs(matrix.m23) > 0.06
			)
		}, sign)
	const checkStagger = (sign: -1 | 1) =>
		page.waitForFunction((direction) => {
			const [expand, clear] = document.querySelectorAll<HTMLButtonElement>(
				`ecology-map-actions > button`,
			)
			if (!expand || !clear || expand.hidden || clear.hidden) return false
			const opacityGap =
				Number(getComputedStyle(expand).opacity) -
				Number(getComputedStyle(clear).opacity)
			return direction * opacityGap > 0.04
		}, sign)
	assert.equal(await mapActions.getByRole(`button`).count(), 0)
	await Promise.all([checkDepth(-1), choose(`state:price`)])
	assert.equal(await mapActions.getByRole(`button`).count(), 1)
	await Promise.all([checkDepth(1), clearSelection.click()])
	await ready()
	assert.equal(await mapActions.getByRole(`button`).count(), 0)
	assert.equal(await page.locator(`ecology-scene:focus`).count(), 1)
	await mapActions.locator(`[data-action="clear"]`).waitFor({ state: `hidden` })
	await Promise.all([checkStagger(1), choose(`family:items`)])
	await expandFamily.click()
	await ready()
	assert.equal(await collapseFamily.getAttribute(`aria-expanded`), `true`)
	assert.equal(
		await collapseFamily.locator(`svg`).getAttribute(`data-editor-icon`),
		`collapseFamily`,
	)
	await collapseFamily.press(`Space`)
	await ready()
	assert.equal(await expandFamily.getAttribute(`aria-expanded`), `false`)
	assert.equal(
		await expandFamily.locator(`svg`).getAttribute(`data-editor-icon`),
		`expandFamily`,
	)
	assert.deepEqual(
		await mapActions.evaluate((actions) => {
			const overlay = actions as HTMLElement
			const map = overlay.offsetParent as HTMLElement
			const [expand, clear] = overlay.querySelectorAll(`button`)
			const hinge = (button: HTMLButtonElement) => {
				const [x, y] = getComputedStyle(button)
					.transformOrigin.split(` `)
					.map(Number.parseFloat)
				return [button.offsetLeft + x, button.offsetTop + y - map.clientHeight]
			}
			return {
				left: expand.offsetLeft,
				bottom: map.clientHeight - expand.offsetTop - expand.offsetHeight,
				gap: clear.offsetLeft - expand.offsetLeft - expand.offsetWidth,
				sizes: [
					expand.offsetWidth,
					expand.offsetHeight,
					clear.offsetWidth,
					clear.offsetHeight,
				],
				hinges: [hinge(expand), hinge(clear)],
			}
		}),
		{
			left: 2,
			bottom: 2,
			gap: 2,
			sizes: [32, 32, 32, 32],
			hinges: [
				[0, 0],
				[0, 0],
			],
		},
	)
	await Promise.all([checkStagger(-1), clearSelection.press(`Escape`)])
	await ready()
	assert.equal(await mapActions.getByRole(`button`).count(), 0)

	// Verify browser paint ordering at an actual curve/card intersection. Temporarily
	// enable stroke hit testing and place an unrelated card under that point.
	for (const selected of [`price`, `lazy`]) {
		await choose(`state:${selected}`)
		await page.waitForSelector(`ecology-node-card:not([inert]) > svg > path`)
		const ordering = await page.evaluate(() => {
			const scene = document.querySelector(`ecology-scene`)!,
				bounds = scene.getBoundingClientRect()
			const card = (key: string) =>
				scene.querySelector<HTMLElement>(
					`ecology-node-card:not([inert]):has(> button[data-graph-id="state:${key}"])`,
				)!
			const source = card(`price`),
				other = card(`lazy`),
				path = source.querySelector<SVGPathElement>(`:scope > svg > path`)!
			const length = path.getTotalLength(),
				matrix = path.getScreenCTM()!
			let point = new DOMPoint()
			for (let step = 2; step < 19; step++) {
				const candidate = path
					.getPointAtLength((length * step) / 20)
					.matrixTransform(matrix)
				if (
					candidate.x > bounds.left + 100 &&
					candidate.x < bounds.right - 100 &&
					candidate.y > bounds.top + 40 &&
					candidate.y < bounds.bottom - 40
				) {
					point = candidate
					break
				}
			}
			if (!point.x) throw new Error(`No visible curve point`)
			const transform = other.style.transform,
				style = path.style.cssText
			other.style.transform = `translate(${point.x - bounds.left - 88}px,${point.y - bounds.top - 26}px)`
			path.style.pointerEvents = `stroke`
			path.style.strokeWidth = `8px`
			const top = document
				.elementFromPoint(point.x, point.y)!
				.closest(`ecology-node-card:not([inert])`)!
			const result = {
				front: top.querySelector<HTMLElement>(`button`)!.dataset[`graphId`],
				sourceZ: Number(source.style.zIndex),
				otherZ: Number(other.style.zIndex),
				interactive: getComputedStyle(source.querySelector(`:scope > svg`)!)
					.pointerEvents,
			}
			other.style.transform = transform
			path.style.cssText = style
			return result
		})
		assert.equal(
			ordering.front,
			`state:${selected}`,
			`Arrows must share their source's stacking layer`,
		)
		assert.equal(ordering.sourceZ > ordering.otherZ, selected === `price`)
		assert.equal(
			ordering.interactive,
			`none`,
			`Arrows must not intercept camera or card input`,
		)
	}
	await page.locator(`ecology-scene`).focus()
	await page.keyboard.press(`Escape`)
	await ready()
	await choose(`family:items`)
	const movement = await page.evaluate(async () => {
		const scene = document.querySelector<HTMLElement>(`ecology-scene`)!
		const member = () =>
			scene.querySelector<HTMLElement>(
				`ecology-node-card:not([inert]):has(> button[data-graph-id='state:items("a")'])`,
			)!
		const frame = () => new Promise(requestAnimationFrame)
		const settled = async () => {
			while (
				document.querySelector<HTMLElement>(`ecology-view`)!.dataset[`ready`] !==
				`true`
			)
				await new Promise((resolve) => setTimeout(resolve, 0))
		}
		const toggle = async () => {
			scene.dispatchEvent(
				new KeyboardEvent(`keydown`, {
					key: `Enter`,
					bubbles: true,
					cancelable: true,
				}),
			)
			await settled()
		}
		await toggle()
		await frame()
		const node = member(),
			entrance = Number(getComputedStyle(node).opacity)
		const start = node.style.transform
		const arrow = node.querySelector<SVGPathElement>(`path`)!
		const initialPath = arrow.getAttribute(`d`)
		for (let index = 0; index < 4; index++) await frame()
		const moving =
			node.style.transform !== start && arrow.getAttribute(`d`) !== initialPath
		await toggle()
		const retained = node.isConnected && node.inert
		for (let index = 0; index < 2; index++) await frame()
		const fading = Number(getComputedStyle(node).opacity) < 1
		await toggle()
		const revived = member() === node && !node.inert
		for (let index = 0; index < 45; index++) await frame()
		return {
			entrance,
			moving,
			retained,
			fading,
			revived,
			opacity: Number(getComputedStyle(node).opacity),
			target: node.style.transform,
		}
	})
	assert.ok(
		movement.entrance >= 0 && movement.entrance < 1,
		`Members must fade in`,
	)
	assert.equal(
		movement.moving,
		true,
		`World positions and outgoing arrows must move together`,
	)
	assert.equal(
		movement.retained,
		true,
		`Collapsing members must remain inert while exiting`,
	)
	assert.equal(movement.fading, true)
	assert.equal(
		movement.revived,
		true,
		`Rapid reversal must revive the same member card`,
	)
	assert.equal(movement.opacity, 1)
	await page.emulateMedia({ reducedMotion: `reduce` })
	await sceneToggle()
	await sceneToggle()
	await page.evaluate(() => new Promise(requestAnimationFrame))
	const reduced = await page
		.locator(
			`ecology-node-card:not([inert]):has(> button[data-graph-id='state:items("a")'])`,
		)
		.evaluate((node) => ({
			opacity: Number(getComputedStyle(node).opacity),
			position: (node as HTMLElement).style.transform,
		}))
	assert.equal(reduced.opacity, 1)
	assert.equal(reduced.position, movement.target)
	await sceneToggle()
	await page.locator(`ecology-scene`).focus()
	await page.keyboard.press(`Escape`)
	await ready()
	await page.emulateMedia({ reducedMotion: `no-preference` })
	async function sceneToggle() {
		await page.locator(`ecology-scene`).focus()
		await page.keyboard.press(`Enter`)
		await ready()
	}
	const row = page.locator(`ecology-editor-row[data-row-id="state:price"]`),
		originalRow = await row.elementHandle()
	const rowTransforms = await row.evaluateHandle((node: HTMLElement) => {
		const samples = [node.style.transform]
		const observer = new MutationObserver(() =>
			samples.push(node.style.transform),
		)
		observer.observe(node, { attributes: true, attributeFilter: [`style`] })
		return {
			stop() {
				observer.disconnect()
				return samples
			},
		}
	})
	await choose(`state:price`)
	const rowMotion = await row.evaluate(async (node) => {
		for (let index = 0; index < 10; index++)
			await new Promise(requestAnimationFrame)
		return node.getAttributeNames().filter((name) => name.startsWith(`motion:`))
	})
	const samples = await rowTransforms.evaluate((capture) => capture.stop())
	await rowTransforms.dispose()
	assert.equal(
		await row.evaluate((node, original) => node === original, originalRow),
		true,
	)
	assert.ok(
		new Set(samples).size > 1,
		`Editor rows must project between sections`,
	)
	assert.deepEqual(rowMotion, [])
	// Window movement must not become a spring animation on every editor row.
	await page
		.getByRole(`button`, { name: `Debugger layout`, exact: true })
		.click()
	await page.getByRole(`button`, { name: `Restore free position` }).click()
	await page.waitForTimeout(700)
	const move = page.getByRole(`button`, { name: `Move debugger`, exact: true })
	const handle = (await move.boundingBox())!
	await page.mouse.move(handle.x + 18, handle.y + 16)
	await page.mouse.down()
	const tracking = page.locator(`ecology-editor`).evaluate(async (editor) => {
		const panel = editor.closest(`debugger-panel`)!
		const rows = [
			...editor.querySelectorAll(`ecology-editor-row:not([hidden]), h3`),
		]
		const local = () => {
			const parent = panel.getBoundingClientRect()
			return rows.map((node) => {
				const rect = node.getBoundingClientRect()
				return { x: rect.x - parent.x, y: rect.y - parent.y }
			})
		}
		const baseline = local(),
			positions = new Set<number>()
		let deviation = 0
		for (let index = 0; index < 60; index++) {
			await new Promise(requestAnimationFrame)
			positions.add(panel.getBoundingClientRect().x)
			for (const [offset, point] of local().entries())
				deviation = Math.max(
					deviation,
					Math.hypot(point.x - baseline[offset].x, point.y - baseline[offset].y),
				)
		}
		return { deviation, positions: positions.size }
	})
	await page.mouse.move(handle.x + 198, handle.y + 106, { steps: 25 })
	await page.keyboard.press(`Escape`)
	await page.mouse.up()
	const tracked = await tracking
	assert.ok(tracked.positions > 5, `Observe multiple real window positions`)
	assert.ok(tracked.deviation < 1, `Editor rows must move with the window`)
	assert.equal(
		await row.evaluate((node, original) => node === original, originalRow),
		true,
	)
	await page
		.getByRole(`button`, { name: `Debugger layout`, exact: true })
		.click()
	await page.getByRole(`button`, { name: `Full viewport`, exact: true }).click()
	await page.locator(`ecology-scene`).focus()
	await page.keyboard.press(`Escape`)
	await ready()

	const palette = async () => {
		const cards = await page
			.locator(`ecology-node-card:not([inert]):not([hidden])`)
			.evaluateAll((nodes) =>
				nodes.map((node) => ({
					id: node.querySelector<HTMLElement>(`button`)!.dataset[`graphId`],
					color: getComputedStyle(node)
						.getPropertyValue(`--ecology-color`)
						.trim(),
					border: getComputedStyle(node.querySelector(`button`)!).borderTopColor,
					iconFill: getComputedStyle(
						node.querySelector(`ecology-primitive-icon svg`)!,
					).fill,
				})),
			)
		for (const card of cards) {
			assert.equal(
				card.border.replaceAll(` `, ``),
				new Color(card.color).getStyle(),
				`Border must retain its key color: ${card.id}`,
			)
			assert.equal(card.iconFill, card.border, `Card icon color: ${card.id}`)
		}
		return cards
	}
	for (const colorScheme of [`light`, `dark`] as const) {
		await page.emulateMedia({ colorScheme })
		const cards = await palette()
		assert.equal(new Set(cards.map((card) => card.color)).size, cards.length)
		const rows = await page
			.locator(`ecology-editor-row:not([hidden])`)
			.evaluateAll((nodes) =>
				nodes.map((node) => ({
					id: node.getAttribute(`data-row-id`),
					border: getComputedStyle(node).borderLeftColor,
					iconFill: getComputedStyle(
						node.querySelector(`ecology-primitive-icon svg`)!,
					).fill,
				})),
			)
		assert.ok(rows.length > 0)
		for (const { id, iconFill, border } of rows)
			assert.equal(iconFill, border, `Editor icon color: ${id}`)
	}
	const operations = await context.newPage()
	try {
		await operations.goto(
			`http://127.0.0.1:${(server.address() as AddressInfo).port}/?inline&operations`,
		)
		for (const colorScheme of [`light`, `dark`] as const) {
			await operations.emulateMedia({ colorScheme })
			for (const [id, kind, detail] of [
				[`transaction:save`, `transaction`, `Transaction`],
				[`timeline:price history`, `timeline`, `Timeline · 0/0 steps`],
				[
					`timeline_family:histories`,
					`timeline-family`,
					`Timeline Family · 1 members`,
				],
			]) {
				const card = operations.locator(
					`ecology-node-card > button[data-graph-id="${id}"]`,
				)
				assert.equal(await card.locator(`small`).textContent(), detail)
				assert.equal(
					await card
						.locator(`ecology-primitive-icon`)
						.getAttribute(`data-primitive`),
					kind,
				)
				const editorIcon = operations.locator(
					`ecology-editor-row[data-row-id="${id}"] > ecology-primitive-icon`,
				)
				assert.equal(await editorIcon.getAttribute(`data-primitive`), kind)
				const [cardColors, editorColors] = await Promise.all([
					card.evaluate((node) => ({
						fill: getComputedStyle(
							node.querySelector(`ecology-primitive-icon svg`)!,
						).fill,
						border: getComputedStyle(node).borderTopColor,
					})),
					editorIcon.evaluate((node) => ({
						fill: getComputedStyle(node.querySelector(`svg`)!).fill,
						border: getComputedStyle(node.parentElement!).borderLeftColor,
					})),
				])
				assert.equal(
					cardColors.fill,
					cardColors.border,
					`${id} card in ${colorScheme}`,
				)
				assert.equal(
					editorColors.fill,
					editorColors.border,
					`${id} row in ${colorScheme}`,
				)
				assert.equal(
					cardColors.fill,
					editorColors.fill,
					`${id} color in ${colorScheme}`,
				)
			}
		}
		for (const [id, relation, pattern] of [
			[`transaction:save`, `transaction`, `6px, 4px`],
			[`timeline:price history`, `timeline`, `0.5px, 4px`],
			[`timeline_family:histories`, `timeline`, `0.5px, 4px`],
		]) {
			const path = operations.locator(
				`ecology-node-card:has(> button[data-graph-id="${id}"]) > svg > path[data-relation="${relation}"]`,
			)
			const { dasharray, stroke, border } = await path.evaluate((node) => {
				const style = getComputedStyle(node)
				const card = node.closest(`ecology-node-card`)!.querySelector(`button`)!
				return {
					dasharray: style.strokeDasharray,
					stroke: style.stroke,
					border: getComputedStyle(card).borderTopColor,
				}
			})
			assert.equal(dasharray, pattern)
			assert.equal(stroke, border)
		}
		const selectorArrow = operations.locator(
			`ecology-node-card:has(> button[data-graph-id="state:price"]) > svg > path`,
		)
		assert.equal(
			await selectorArrow.evaluate(
				(node) => getComputedStyle(node).strokeDasharray,
			),
			`none`,
		)
		await operations
			.getByRole(`button`, { name: `Expand transaction save` })
			.click()
		assert.equal(
			await operations
				.locator(`ecology-editor transaction-outcomes`)
				.textContent(),
			`No recorded outcomes`,
		)
		await operations
			.getByRole(`button`, { name: `Expand timeline price history` })
			.click()
		assert.equal(
			await operations
				.locator(`ecology-editor timeline-history [data-cursor]`)
				.textContent(),
			`you are here`,
		)
		assert.equal(
			await operations
				.locator(`ecology-editor timeline-travel button:disabled`)
				.count(),
			2,
		)
	} finally {
		await operations.close()
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
	assert.equal(await page.locator(`ecology-actions > button`).count(), 2)
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
	const resetView = page.getByRole(`button`, { name: `Reset view`, exact: true })
	await resetView.click()
	const arrow = scene.locator(`ecology-node-card > svg > path`).first()
	const arrowBefore = await arrow.getAttribute(`d`)
	const pose = await camera(),
		bounds = (await scene.boundingBox())!
	await page.mouse.move(bounds.x + 15, bounds.y + 15)
	await page.mouse.down()
	await page.mouse.move(bounds.x + 65, bounds.y + 40, { steps: 5 })
	await page.mouse.up()
	assert.notEqual(await camera(), pose, `Mouse drag must orbit`)
	await page.waitForFunction(
		(previous) =>
			document
				.querySelector(`ecology-scene ecology-node-card > svg > path`)!
				.getAttribute(`d`) !== previous,
		arrowBefore,
	)
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
		.locator(`ecology-node-card:not([inert])`)
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
	await resetView.click()
	await page.waitForFunction((startingPose) => {
		const resetPose = document
			.querySelector(`ecology-scene`)!
			.getAttribute(`data-camera`)!
			.split(`,`)
			.map(Number)
		return startingPose.every(
			(value, index) => Math.abs(value - resetPose[index]) < 0.00001,
		)
	}, pose!.split(`,`).map(Number))
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
			`"a"`,
		)
		assert.equal(
			await page
				.locator(`ecology-node-card:not([inert]) > button[aria-pressed="true"]`)
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
	await page.getByRole(`button`, { name: `Collapse items`, exact: true }).click()
	await ready()
	await scene.focus()
	assert.equal(await scene.getAttribute(`data-family-connections`), `0`)
	await page.keyboard.press(`Enter`)
	await ready()
	assert.equal(await scene.getAttribute(`data-family-connections`), `1`)
	const familyMember = page.locator(
		`ecology-node-card:not([inert]) > button[data-graph-id='state:items("a")']`,
	)
	assert.equal(await familyMember.locator(`strong`).innerText(), `"a"`)
	assert.equal(
		await familyMember.locator(`small[data-family]`).innerText(),
		`items`,
	)
	assert.equal(
		await familyMember.evaluate((button) => {
			const family = button.querySelector(`small[data-family]`)!,
				name = button.querySelector(`strong`)!
			return (
				getComputedStyle(family).color ===
					getComputedStyle(button).borderTopColor &&
				parseFloat(getComputedStyle(family).fontSize) <
					parseFloat(getComputedStyle(name).fontSize) &&
				family.getBoundingClientRect().top < name.getBoundingClientRect().top
			)
		}),
		true,
	)
	assert.equal(
		await page
			.getByRole(`button`, { name: `Collapse items`, exact: true })
			.count(),
		1,
	)
	await page.keyboard.press(`Enter`)
	await ready()
	assert.equal(
		await page
			.getByRole(`button`, { name: `Expand items`, exact: true })
			.count(),
		1,
	)
	await page.keyboard.press(`Enter`)
	await ready()
	await page.getByRole(`button`, { name: `Collapse items`, exact: true }).click()
	await ready()
	await page.getByRole(`button`, { name: `Expand items`, exact: true }).click()
	await ready()
	await page.getByRole(`button`, { name: `Collapse items`, exact: true }).click()
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
				`ecology-node-card:not([inert]):not([hidden])`,
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
			.locator(`ecology-node-card:not([inert])[data-traced="true"] > button`)
			.evaluateAll((nodes) =>
				nodes.map((node) => (node as HTMLElement).dataset[`graphId`]).sort(),
			),
		[`state:price`, `state:total`],
	)
	await palette()
	assert.equal(
		await page
			.locator(
				`ecology-node-card:not([inert]):has([data-graph-id="state:lazy"])`,
			)
			.evaluate(
				(node) => getComputedStyle(node.querySelector(`button`)!).opacity,
			),
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
		await page
			.locator(`ecology-node-card:not([inert])[data-dimmed="true"]`)
			.count(),
		0,
	)
	await choose(`state:price`)
	assert.equal(
		await page
			.locator(
				`ecology-node-card:not([inert]):has([data-graph-id="state:total"])`,
			)
			.getAttribute(`data-traced`),
		`true`,
	)
	await choose(`state:total`)
	assert.match(await page.locator(`ecology-editor`).innerText(), /price/)
	await page.screenshot({ path: resolvePath(artifacts, `small-traced.png`) })
	const positions = await page
		.locator(`ecology-node-card:not([inert]) > button[data-graph-id]`)
		.evaluateAll((nodes) =>
			nodes.map((node) => [
				node.dataset[`graphId`],
				node
					.closest(`ecology-node-card:not([inert])`)!
					.getAttribute(`data-position`),
			]),
		)
	await page.evaluate(() => {
		window.ecologyFixture.change()
	})
	await page.waitForFunction(() => {
		const price = document.querySelector(
			`ecology-node-card button[data-graph-id="state:price"]`,
		)
		const total = document.querySelector(
			`ecology-node-card button[data-graph-id="state:total"]`,
		)
		return (
			price?.textContent?.includes(`Atom · 6`) &&
			total?.textContent?.includes(`Selector · 12`) &&
			price
				.getAnimations()
				.some(
					({ effect }) =>
						effect instanceof KeyframeEffect &&
						effect.getKeyframes().some((frame) => `backgroundColor` in frame),
				)
		)
	})
	assert.deepEqual(
		await page
			.locator(`ecology-node-card:not([inert]) > button[data-graph-id]`)
			.evaluateAll((nodes) =>
				nodes.map((node) => [
					node.dataset[`graphId`],
					node
						.closest(`ecology-node-card:not([inert])`)!
						.getAttribute(`data-position`),
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
		.locator(`debugger-panel[data-css="devtools"]`)
		.boundingBox()
	if (!beforeGeometry) throw new Error(`Missing beforeGeometry`)
	await page.getByRole(`button`, { name: `Move debugger`, exact: true }).focus()
	await page.keyboard.press(`ArrowLeft`)
	assert.equal(
		(await page.locator(`debugger-panel[data-css="devtools"]`).boundingBox())!.x,
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
			`ecology-node-card:not([inert]):not([hidden]) > button[data-graph-id]`,
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
		await page
			.locator(`ecology-node-card:not([inert]) > button[data-graph-id]`)
			.count(),
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
						`ecology-node-card:not([inert]):not([data-collapsed="true"]) > button[data-graph-id]`,
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
	// Keep the added orbit workload separate from the existing search/selection measurements.
	await page.getByRole(`searchbox`, { name: `Search ecology` }).fill(``)
	await ready()
	await scene.focus()
	await page.keyboard.press(`Escape`)
	await ready()
	await page.getByRole(`button`, { name: `Reset view`, exact: true }).click()
	await page.waitForFunction(
		() =>
			document.querySelector(`ecology-scene`)!.getAttribute(`data-edges`) ===
			`1000`,
	)
	const orbitBounds = (await scene.boundingBox())!
	await page.mouse.move(orbitBounds.x + 15, orbitBounds.y + 15)
	await page.mouse.down()
	const [orbitIntervals] = await Promise.all([
		page.evaluate(async () => {
			const intervals: number[] = []
			let previous = performance.now()
			for (let frame = 0; frame < 30; frame++) {
				await new Promise(requestAnimationFrame)
				const now = performance.now()
				intervals.push(now - previous)
				previous = now
			}
			return intervals
		}),
		page.mouse.move(orbitBounds.x + 100, orbitBounds.y + 50, { steps: 30 }),
	])
	await page.mouse.up()
	await page.getByRole(`button`, { name: `Reset view`, exact: true }).click()
	await page.evaluate(() => new Promise(requestAnimationFrame))
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
		orbit: {
			frames: orbitIntervals.length,
			p95FrameIntervalMs: p95(orbitIntervals),
			intervals: orbitIntervals,
			method: `Animation frame intervals during a real mouse orbit at the 500-card / 1,000-arrow paint cap using software WebGL.`,
		},
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
	await page.emulateMedia({ reducedMotion: `no-preference` })
	await page.evaluate(() => {
		window.ecologyFixture.mount(`small`)
	})
	await ready()
	await page.evaluate(() => {
		window.ecologyFixture.showCaughtError()
	})
	const broken = page.locator(
		`ecology-node-card button[data-graph-id="state:broken"]`,
	)
	const reveal = broken.locator(`[data-error-reveal]`)
	const explosion = reveal.locator(`[data-explosion] > img`)
	await broken.and(page.locator(`[data-caught="revealing"]`)).waitFor()
	const bands = await reveal.evaluate((layer) =>
		[`::before`, `::after`].map((side) => {
			const style = getComputedStyle(layer, side)
			return {
				duration: style.animationDuration,
				start: style.getPropertyValue(`--ecology-band-start`),
			}
		}),
	)
	assert.deepEqual(
		bands.map(({ duration }) => duration),
		[`0.32s`, `0.32s`],
	)
	assert.match(bands[0].start, /inset\(0 0 100%/)
	assert.match(bands[1].start, /inset\(100%/)
	const { coverage, size } = await explosion.evaluate(
		async (image: HTMLImageElement) => {
			await image.decode()
			const frameCount = 17
			const width = image.naturalWidth / frameCount
			const height = image.naturalHeight
			const canvas = document.createElement(`canvas`)
			canvas.width = width
			canvas.height = height
			const drawing = canvas.getContext(`2d`, { willReadFrequently: true })!
			const visibleByFrame: number[] = []
			for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
				drawing.clearRect(0, 0, width, height)
				drawing.drawImage(
					image,
					frameIndex * width,
					0,
					width,
					height,
					0,
					0,
					width,
					height,
				)
				const pixels = drawing.getImageData(0, 0, width, height).data
				let visible = 0
				for (let alpha = 3; alpha < pixels.length; alpha += 4)
					if (pixels[alpha]) visible++
				visibleByFrame.push(visible)
			}
			return { coverage: visibleByFrame, size: [width, height] }
		},
	)
	assert.deepEqual(size, [142, 200])
	const peak = Math.max(...coverage)
	assert.ok(coverage[0] < peak * 0.03 && coverage.at(-1)! < peak * 0.03)
	const threshold = peak * 0.35
	assert.equal(
		coverage.filter(
			(visible, index) =>
				visible >= threshold && (coverage[index - 1] ?? 0) < threshold,
		).length,
		1,
	)
	for (let attempt = 0; attempt < 3; attempt++) {
		await page.waitForFunction(() =>
			document
				.querySelector(`[data-graph-id="state:broken"] [data-explosion] > img`)
				?.getAnimations()
				.some((animation) => Number(animation.currentTime) >= 350),
		)
		const restarted = await broken.evaluate((button) => {
			const revealAnimations = () =>
				button
					.querySelector(`[data-error-reveal]`)
					?.getAnimations({ subtree: true }) ?? []
			const previous = revealAnimations()
			const previousImage = button.querySelector(`[data-explosion] > img`)
			const frameOffset = (image: Element) =>
				new DOMMatrixReadOnly(getComputedStyle(image).transform).m41
			const previousOffset = previousImage ? frameOffset(previousImage) : 0
			return new Promise<boolean>((resolve) => {
				const timeout = setTimeout(() => {
					observer.disconnect()
					resolve(false)
				}, 1500)
				const observer = new MutationObserver(() => {
					const image = button.querySelector(`[data-explosion] > img`)
					if (
						!image ||
						image === previousImage ||
						button.dataset[`caught`] !== `revealing`
					)
						return
					const current = revealAnimations()
					clearTimeout(timeout)
					observer.disconnect()
					resolve(
						previousOffset < 0 &&
							frameOffset(image) === 0 &&
							previous.length === 3 &&
							current.length === 3 &&
							current.every(
								(animation) =>
									!previous.includes(animation) &&
									Number(animation.currentTime) < 100,
							),
					)
				})
				observer.observe(button, { attributes: true, childList: true })
				window.ecologyFixture.showCaughtError()
			})
		})
		assert.equal(
			restarted,
			true,
			`Rejection ${attempt + 2} should restart the blast and both bands`,
		)
	}
	await explosion.waitFor({ state: `detached` })
	assert.equal(await broken.getAttribute(`data-caught`), `true`)
	assert.equal(
		await broken.evaluate(
			(button) => getComputedStyle(button, `::before`).clipPath,
		),
		`none`,
	)
	assert.match(
		await broken.evaluate(
			(button) => getComputedStyle(button, `::before`).backgroundImage,
		),
		/repeating-linear-gradient/,
	)
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
