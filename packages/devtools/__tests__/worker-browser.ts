import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { basename, resolve } from "node:path"

import { build } from "esbuild"
import type { Browser } from "playwright"

import { launchBrowser, loadDevtoolsAssets } from "./browser-runtime.ts"

const demo = resolve(import.meta.dirname, `../exhibits/worker`)
const bundle = await build({
	entryPoints: [resolve(demo, `main.ts`), resolve(demo, `worker.ts`)],
	outdir: `dist/worker-demo`,
	tsconfigRaw: {},
	bundle: true,
	write: false,
	format: `esm`,
	platform: `browser`,
	define: { "import.meta.env.DEV": `false` },
})
const assets = await loadDevtoolsAssets()
for (const file of bundle.outputFiles)
	assets.set(`/` + basename(file.path), {
		type: `application/javascript`,
		body: Buffer.from(file.contents),
	})
const server = createServer((req, res) => {
	const pathname = new URL(req.url ?? `/`, `http://localhost`).pathname
	const asset = assets.get(pathname)
	if (asset) {
		res.setHeader(`content-type`, asset.type)
		res.end(asset.body)
	} else if (pathname === `/`) {
		res.setHeader(`content-type`, `text/html; charset=utf-8`)
		res.end(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worker store · atom.io devtools</title>
<link rel="stylesheet" href="/devtools.css">
<style>
	html { color-scheme: light dark; font: 16px system-ui; }
	body { margin: 2rem; }
	button { font: inherit; }
	output { display: block; margin: 1rem 0; font-variant-numeric: tabular-nums; }
	p { max-width: 34rem; }
</style>
<h1>Worker store</h1>
<button id="increment">Increment in worker</button>
<output id="worker-values">Waiting for the worker…</output>
<p>Use the store picker to switch between the page and worker. In the worker’s Atoms tab, edit <strong>count</strong> and press Enter.</p>
<div id="devtools"></div>
<script type="module" src="/main.js"></script>
</html>`)
	} else {
		res.writeHead(404).end()
	}
})
await new Promise<void>((ready) => server.listen(0, `127.0.0.1`, ready))
const url = `http://127.0.0.1:` + (server.address() as AddressInfo).port
if (process.argv.includes(`--serve`)) {
	process.stdout.write(url + `\n`)
} else {
	let browser: Browser | undefined
	try {
		browser = await launchBrowser({ softwareWebGL: true })
		const page = await browser.newPage({
			viewport: { width: 1200, height: 850 },
			reducedMotion: `reduce`,
		})
		const errors: string[] = []
		page.on(`pageerror`, (error) => errors.push(error.message))
		await page.goto(url)
		const panel = page.locator(`debugger-panel:not([hidden])`)
		const picker = panel.getByRole(`button`, { name: /^Inspected store:/ })
		const storeName = picker.locator(`[data-store-name]`)
		const stores = panel.getByRole(`group`, { name: `Stores`, exact: true })
		const pickerSurface = () =>
			picker.evaluate((element) => {
				const { backgroundColor, borderTopColor } = getComputedStyle(element)
				return [backgroundColor, borderTopColor]
			})
		const switchStore = async (name: string) => {
			await picker.click()
			await stores.getByRole(`button`, { name, exact: true }).click()
		}
		const assertPickerFits = async () => {
			const window = (await panel.boundingBox())!
			const trigger = (await picker.boundingBox())!
			const menu = (await stores.boundingBox())!
			assert.ok(menu.x >= window.x + 8)
			assert.ok(menu.x + menu.width <= window.x + window.width - 8)
			assert.ok(menu.y >= trigger.y + trigger.height + 6)
			assert.ok(menu.y + menu.height <= window.y + window.height)
		}
		const count = panel.getByRole(`textbox`, { name: `count`, exact: true })
		const doubled = panel.getByRole(`textbox`, { name: `doubled`, exact: true })
		const atoms = panel.getByRole(`tab`, { name: `atoms` })
		const selectors = panel.getByRole(`tab`, { name: `selectors` })
		const increment = page.getByRole(`button`, { name: `Increment in worker` })
		const alert = panel.getByRole(`alert`)
		const expectValue = async (label: string, expected: string) => {
			await page.waitForFunction(
				({ key, value }) =>
					document.querySelector<HTMLInputElement>(
						`debugger-panel:not([hidden]) input[aria-label="` + key + `"]`,
					)?.value === value,
				{ key: label, value: expected },
			)
		}
		const expectWorker = async (value: number, derived: number) => {
			await page
				.getByText(`Count: ` + value + ` · Doubled: ` + derived, { exact: true })
				.waitFor()
		}

		await panel.getByRole(`tab`, { name: `ecology` }).click()
		await panel
			.getByRole(`button`, { name: `Search ecology`, exact: true })
			.click()
		const search = panel.getByRole(`dialog`, { name: `Search ecology` })
		await search.getByRole(`searchbox`).fill(`count`)
		await search.locator(`[data-result-id="state:count"]`).waitFor()
		await search.locator(`[data-result-id="timeline:count"]`).waitFor()
		await search.getByRole(`searchbox`).fill(`increment`)
		await search.locator(`[data-result-id="transaction:increment"]`).waitFor()
		await search.getByRole(`searchbox`).fill(``)
		await search.getByRole(`button`, { name: `Close search` }).click()
		await atoms.click()
		await expectValue(`count`, `2`)
		await increment.click()
		await expectValue(`count`, `3`)
		await selectors.click()
		await expectValue(`doubled`, `6`)
		assert.equal(await doubled.getAttribute(`readonly`), ``)
		assert.equal(
			await panel.getByRole(`heading`, { name: `atom.io`, exact: true }).count(),
			1,
		)
		assert.equal(await storeName.textContent(), `Counter worker`)
		assert.ok(await storeName.isVisible())
		await picker.hover()
		const transparent = `rgba(0, 0, 0, 0)`
		assert.deepEqual(await pickerSurface(), [transparent, transparent])
		const restingBounds = await picker.boundingBox()
		await picker.press(`Enter`)
		for (const color of await pickerSurface())
			assert.notEqual(color, transparent)
		assert.deepEqual(await picker.boundingBox(), restingBounds)
		assert.deepEqual(
			await stores.locator(`[data-store-group] > p`).allTextContents(),
			[`Local`, `Remote`],
		)
		const current = stores.getByRole(`button`, {
			name: `Counter worker`,
			exact: true,
		})
		assert.equal(await current.getAttribute(`aria-current`), `true`)
		assert.ok(
			await current.evaluate((element) => element === document.activeElement),
		)
		await current.press(`Escape`)
		await stores.waitFor({ state: `hidden` })
		assert.ok(
			await picker.evaluate((element) => element === document.activeElement),
		)
		await switchStore(`Page store`)
		await atoms.click()
		await expectValue(`location`, `Main thread`)
		await increment.click()
		await expectWorker(4, 8)
		await switchStore(`Counter worker`)
		await expectValue(`doubled`, `8`)

		await atoms.click()
		await count.fill(`17`)
		await expectWorker(4, 8)
		await count.press(`Enter`)
		await expectWorker(17, 34)
		await expectValue(`count`, `17`)
		await selectors.click()
		await expectValue(`doubled`, `34`)

		await atoms.click()
		await count.fill(`20`)
		// Send a worker update while the input still holds an unsubmitted draft.
		await increment.evaluate((button: HTMLButtonElement) => {
			button.click()
		})
		await expectWorker(18, 36)
		assert.equal(await count.inputValue(), `20`)
		await count.press(`Enter`)
		await alert
			.filter({ hasText: `Remote state changed while you were editing` })
			.waitFor()
		await expectValue(`count`, `18`)
		await count.fill(`25`)
		await count.press(`Enter`)
		await expectWorker(25, 50)
		await selectors.click()
		await expectValue(`doubled`, `50`)
		await alert.waitFor({ state: `hidden` })

		await panel.getByRole(`tab`, { name: `transactions` }).click()
		assert.deepEqual(errors, [])
		await panel.getByTestId(`open-close-transaction-increment`).click()
		await panel
			.getByTestId(`transaction-increment`)
			.getByText(`transaction_outcome`)
			.first()
			.waitFor()
		await panel.getByRole(`tab`, { name: `timelines` }).click()
		const timeline = panel.getByTestId(`timeline-count`)
		await timeline.getByRole(`button`, { name: `undo` }).click()
		await expectWorker(18, 36)
		await timeline.getByRole(`button`, { name: `redo` }).click()
		await expectWorker(25, 50)

		await panel.getByRole(`tab`, { name: `ecology` }).click()
		const ecology = panel.getByTestId(`ecology-view`)
		for (const [id, relation] of [
			[`state:count`, `:not([data-relation])`],
			[`transaction:increment`, `[data-relation="transaction"]`],
			[`timeline:count`, `[data-relation="timeline"]`],
		]) {
			await ecology
				.locator(
					`ecology-node-card:has(> button[data-graph-id="${id}"]) > svg > path[d]:not([d=""])${relation}`,
				)
				.first()
				.waitFor({ state: `attached` })
		}
		const scene = ecology.locator(`ecology-scene`)
		const operationCard = (id: string) =>
			scene.locator(`button[data-graph-id="${id}"]`)
		const transactionCard = operationCard(`transaction:increment`)
		await transactionCard.press(`Enter`)
		await scene
			.locator(
				`[data-history="outcome"] > svg > path[data-relation="transaction"]`,
			)
			.first()
			.waitFor({ state: `attached` })
		await ecology.locator(`transaction-outcomes event-view`).first().waitFor()
		const outcomeEntry = ecology.getByRole(`button`, {
			name: `Select outcome 1`,
			exact: true,
		})
		const outcomeId = (await outcomeEntry.getAttribute(`data-graph-id`))!
		await outcomeEntry.hover()
		await scene
			.locator(
				`ecology-node-card[data-hovered="true"] > button[data-graph-id="${outcomeId}"]`,
			)
			.waitFor()
		await outcomeEntry.click()
		await scene
			.locator(`button[data-graph-id="${outcomeId}"][aria-pressed="true"]`)
			.waitFor()
		const outline = (element: Element) => {
			const { outlineColor, outlineStyle, outlineWidth } =
				getComputedStyle(element)
			return [outlineColor, outlineStyle, outlineWidth]
		}
		const mapOutline = await operationCard(outcomeId).evaluate(outline)
		assert.deepEqual(mapOutline.slice(1), [`solid`, `2px`])
		assert.deepEqual(
			await outcomeEntry.locator(`..`).evaluate(outline),
			mapOutline,
		)

		const timelineCard = operationCard(`timeline:count`)
		await timelineCard.press(`Enter`)
		await scene.locator(`[data-history="past"]`).first().waitFor()
		await scene
			.locator(
				`ecology-node-card[data-history="past"]:has(> button[aria-label^="increment · Past"])`,
			)
			.first()
			.locator(`svg > path[data-relation="timeline"][d]:not([d=""])`)
			.nth(1)
			.waitFor({ state: `attached` })
		await timelineCard
			.locator(`..`)
			.locator(`svg > path[data-relation="timeline"]`)
			.waitFor({ state: `attached` })
		await ecology
			.locator(`ecology-scene[data-history-connections="2"]`)
			.waitFor()
		const eventCard = scene
			.locator(
				`ecology-node-card[data-history="past"] > button[aria-label^="increment · Past"]`,
			)
			.first()
		const eventId = (await eventCard.getAttribute(`data-graph-id`))!
		await eventCard.press(`Enter`)
		await ecology
			.locator(
				`timeline-history button[data-graph-id="${eventId}"][aria-pressed="true"]`,
			)
			.waitFor()
		const travel = ecology.locator(`node-heading > timeline-travel`)
		const undo = travel.getByRole(`button`, { name: `undo` })
		await undo.locator(`[data-editor-icon="undo"]`).waitFor()
		await undo.click()
		await expectWorker(18, 36)
		const futureEvent = scene.locator(`[data-history="future"]`).first()
		await futureEvent.waitFor()
		const position = (node: Element) =>
			Number(node.getAttribute(`data-position`)!.split(`,`)[1])
		assert.ok(
			(await futureEvent.evaluate(position)) <
				(await timelineCard.locator(`..`).evaluate(position)),
		)
		await travel.getByRole(`button`, { name: `redo` }).click()
		await expectWorker(25, 50)
		await futureEvent.waitFor({ state: `detached` })
		await timelineCard.press(`Enter`)
		await transactionCard.press(`Enter`)
		await ecology
			.locator(`ecology-scene[data-history-connections="0"]`)
			.waitFor()
		assert.deepEqual(errors, [])
		const screenshot = process.env[`SPA_DEVTOOLS_WORKER_SCREENSHOT`]
		await picker.click()
		await stores.waitFor()
		await assertPickerFits()
		assert.ok(
			await stores.evaluate((menu) => {
				const bounds = menu.getBoundingClientRect()
				return menu.contains(
					document.elementFromPoint(bounds.right - 4, bounds.top + 13),
				)
			}),
		)
		if (screenshot) await page.screenshot({ path: screenshot })
		await picker.click()

		await page.setViewportSize({ width: 1080, height: 850 })
		await panel
			.getByRole(`button`, { name: `Debugger layout`, exact: true })
			.click()
		await panel.getByRole(`button`, { name: `Left third`, exact: true }).click()
		await storeName.waitFor({ state: `hidden` })
		assert.ok(await picker.locator(`[data-store-caret]`).isVisible())
		assert.ok((await picker.boundingBox())!.width <= 28)
		assert.equal(
			await panel.getByRole(`heading`, { name: `atom.io`, exact: true }).count(),
			1,
		)
		await picker.click()
		await stores.waitFor()
		await assertPickerFits()
		await stores.getByRole(`button`, { name: `Page store`, exact: true }).click()
		await expectValue(`location`, `Main thread`)
		process.stdout.write(`Worker devtools round trip passed\n`)
	} finally {
		await browser?.close()
		server.close()
	}
}
