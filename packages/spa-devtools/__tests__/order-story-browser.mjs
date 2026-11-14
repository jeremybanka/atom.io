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
let browser
try {
	browser = await chromium.launch({ chromiumSandbox: true })
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	})
	await context.addInitScript(() => {
		localStorage.setItem(`🔍 Devtools View`, JSON.stringify(`ecology`))
		localStorage.setItem(`🔍 Devtools Are Hidden`, `false`)
		localStorage.setItem(`🔍 Devtools Are Open`, `true`)
		localStorage.setItem(
			`🔍 Devtools Window`,
			JSON.stringify({
				free: { x: 720, y: 0, width: 720, height: 900 },
				snap: `right-half`,
			}),
		)
	})
	const page = await context.newPage(),
		errors = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	const url = `http://127.0.0.1:${server.address().port}`
	await page.goto(
		`${url}/iframe.html?id=atomiodevtools--ecology-order-fulfillment&viewMode=story`,
	)
	await page.getByTestId(`order-summary`).waitFor()
	const graph = page.getByTestId(`ecology-view`),
		inspector = graph.locator(`.ecology-inspector`)
	const ready = async () => {
		await page.waitForFunction(
			() =>
				document.querySelector(`[data-testid="ecology-view"]`)?.dataset.ready ===
				`true`,
		)
	}
	const project = async (action) => {
		const before = await graph.getAttribute(`data-jobs`)
		await action()
		await page.waitForFunction(
			(old) =>
				document.querySelector(`[data-testid="ecology-view"]`)?.dataset.jobs !==
				old,
			before,
		)
		await ready()
	}
	const choose = async (key, family = false) => {
		await project(() =>
			page.getByRole(`textbox`, { name: `Search ecology` }).fill(key),
		)
		await graph
			.locator(`g[data-graph-id]`)
			.filter({ has: page.locator(`text`) })
			.first()
			.waitFor()
		await graph.locator(`g[data-graph-id]`).evaluateAll(
			(nodes, id) => {
				nodes
					.find((node) => node.dataset.graphId === id)
					?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
			},
			`${family ? `family` : `state`}:${key}`,
		)
		assert.ok((await inspector.innerText()).includes(key))
	}
	const trace = async () => {
		await project(() =>
			page
				.getByRole(`button`, { name: `Trace observed roots`, exact: true })
				.click(),
		)
	}
	const refresh = async () => {
		await project(() =>
			page.getByRole(`button`, { name: `Refresh`, exact: true }).click(),
		)
	}
	const showGraph = async () => {
		if (
			await page.getByRole(`textbox`, { name: `Search ecology` }).inputValue()
		) {
			await project(() =>
				page.getByRole(`textbox`, { name: `Search ecology` }).fill(``),
			)
		}
		await page.getByRole(`button`, { name: `Fit`, exact: true }).click()
	}
	await ready()
	await choose(`fulfillmentFeeCents`)
	await trace()
	const delivery = await inspector.innerText()
	assert.match(delivery, /deliveryRegion/)
	assert.doesNotMatch(delivery, /pickupStore/)
	await showGraph()
	await page.screenshot({ path: resolve(artifacts, `delivery-roots.png`) })
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
	await showGraph()
	await page.screenshot({ path: resolve(artifacts, `pickup-roots.png`) })
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
	await showGraph()
	await page.screenshot({
		path: resolve(artifacts, `south-warehouse-roots.png`),
	})
	await page.getByRole(`button`, { name: `Add oolong tea`, exact: true }).click()
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
	await page.getByRole(`button`, { name: `Two green teas`, exact: true }).click()
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
		assert.equal(await page.getByTestId(`atom-io-devtools`).count(), 1)
	}
	await page.goto(`${url}/iframe.html?id=atomiodevtools--docs&viewMode=docs`)
	await page.getByText(`OrderSummary`, { exact: true }).first().waitFor()
	const summaryTab = page.getByRole(`tab`, { name: `OrderSummary`, exact: true })
	if (await summaryTab.count()) await summaryTab.click()
	await page
		.getByRole(`row`)
		.filter({ hasText: /scenario/ })
		.first()
		.waitFor()
	await page.screenshot({ path: resolve(artifacts, `props-docs.png`) })
	await page.goto(`${url}/iframe.html?id=atomiodevtools--primary&viewMode=story`)
	await page.getByRole(`button`, { name: `run`, exact: true }).waitFor()
	assert.equal(await page.getByTestId(`order-summary`).count(), 0)
	assert.deepEqual(errors, [])
	await writeFile(
		resolve(artifacts, `report.json`),
		JSON.stringify(
			{
				candidate: process.env.SPA_DEVTOOLS_CANDIDATE_SHA ?? `working-tree`,
				browser: browser.version(),
				chromiumSandbox: true,
				delivery,
				pickup,
				propsDocs: `OrderSummary scenario prop rendered`,
				repeatedResets: 3,
				errors,
				actualStorybook: true,
			},
			null,
			2,
		),
	)
	await context.close()
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
