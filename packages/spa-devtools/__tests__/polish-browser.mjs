import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, resolve } from "node:path"
import { createRequire } from "node:module"
import { build } from "esbuild"
import { chromium } from "playwright"
const baseline = process.argv.includes(`--baseline`)
const artifacts =
	process.env.SPA_DEVTOOLS_POLISH_ARTIFACTS ?? `/tmp/spa-devtools-polish`
await mkdir(artifacts, { recursive: true })
const entry = resolve(import.meta.dirname, `fixtures/polish-browser/main.ts`)
const bundles = {}
const reactVersions = {}
for (const version of [`18`, `19`]) {
	const require = createRequire(
		resolve(
			import.meta.dirname,
			`../peer-environments/coordinated-react${version}/package.json`,
		),
	)
	const react = dirname(require.resolve(`react/package.json`)),
		reactDOM = dirname(require.resolve(`react-dom/package.json`))
	reactVersions[`react${version}`] = JSON.parse(
		await readFile(resolve(react, `package.json`), `utf8`),
	).version
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		format: `esm`,
		platform: `browser`,
		tsconfigRaw: {},
		alias: { react, "react-dom": reactDOM },
		define: { "import.meta.env.DEV": `false` },
	})
	bundles[`/react${version}.js`] = result.outputFiles[0].text
}
bundles[`/spa.js`] = bundles[`/react19.js`]
const css = await readFile(
	resolve(import.meta.dirname, `../dist/devtools.css`),
	`utf8`,
)
const server = createServer((req, res) => {
	const url = new URL(req.url, `http://localhost`),
		mode = url.searchParams.get(`mode`) ?? `spa`
	res.setHeader(
		`content-type`,
		bundles[url.pathname] ? `application/javascript` : `text/html`,
	)
	res.end(
		bundles[url.pathname] ??
			`<style>${css}</style><script type="module" src="/${mode}.js"></script>`,
	)
})
async function checkLongField(page, theme, name, sizing) {
	const input = page.locator(`input[aria-label^="a very long key"]`)
	const original = await input.elementHandle()
	const forced =
		sizing === `fallback`
			? await page.addStyleTag({
					content: `main .elastic-input {field-sizing:fixed !important}`,
				})
			: null
	const samples = []
	const check = async (expected) => {
		const measurement = await input.evaluate((el) => {
			const bounds = (node) => {
				const r = node.getBoundingClientRect()
				return {
					left: r.left,
					right: r.right,
					width: r.width,
					top: r.top,
					bottom: r.bottom,
					height: r.height,
				}
			}
			const wrapper = el.parentElement,
				row = el.closest(`header`),
				panel = el.closest(`main`),
				label = row.querySelector(`.field-name h3`),
				rect = el.getBoundingClientRect()
			return {
				value: el.value,
				input: bounds(el),
				wrapper: bounds(wrapper),
				row: bounds(row),
				panel: bounds(panel),
				clientWidth: el.clientWidth,
				scrollWidth: el.scrollWidth,
				fieldSizing: getComputedStyle(el).fieldSizing,
				title: label.title,
				keyWidth: label.clientWidth,
				keyScrollWidth: label.scrollWidth,
				hitLeft:
					document.elementFromPoint(
						rect.left + rect.width / 3,
						rect.top + rect.height / 2,
					) === el,
				hitRight:
					document.elementFromPoint(
						rect.left + (rect.width * 2) / 3,
						rect.top + rect.height / 2,
					) === el,
				focused: document.activeElement === el,
			}
		})
		samples.push(measurement)
		const details = JSON.stringify({
			theme,
			name,
			sizing,
			expected,
			measurement,
		})
		const fits = (inner, outer) =>
			inner.left >= outer.left - 0.75 &&
			inner.right <= outer.right + 0.75 &&
			inner.top >= outer.top - 0.75 &&
			inner.bottom <= outer.bottom + 0.75
		if (
			!(
				fits(measurement.input, measurement.wrapper) &&
				fits(measurement.input, measurement.row) &&
				fits(measurement.input, measurement.panel)
			)
		)
			await page.screenshot({
				path: resolve(artifacts, `clipped-${theme}-${name}-${sizing}.png`),
			})
		assert.equal(measurement.value, expected, details)
		assert.ok(
			fits(measurement.input, measurement.wrapper) &&
				fits(measurement.input, measurement.row) &&
				fits(measurement.input, measurement.panel),
			`Entire long-key input must be visible: ${details}`,
		)
		assert.ok(
			measurement.clientWidth >= 14 &&
				measurement.scrollWidth <= measurement.clientWidth + 1,
			`Entire numeric text must fit: ${details}`,
		)
		assert.ok(
			measurement.hitLeft && measurement.hitRight && measurement.focused,
			details,
		)
		assert.equal(measurement.row.height, 22, details)
		assert.equal(
			measurement.title,
			await input.getAttribute(`aria-label`),
			details,
		)
		if (name === `narrow`)
			assert.ok(
				measurement.keyScrollWidth > measurement.keyWidth,
				`Key must truncate before the numeric editor: ${details}`,
			)
		assert.equal(
			await original.evaluate(
				(el) => el.isConnected && el === document.activeElement,
			),
			true,
			details,
		)
	}
	await input.fill(`17`)
	await check(`17`)
	await input.press(`End`)
	await input.press(`.`)
	await check(`17.`)
	assert.equal(await page.evaluate(() => window.polish.longValue()), 17)
	await input.fill(`1234567890123.`)
	await check(`1234567890123.`)
	await input.press(`End`)
	await input.press(`5`)
	await check(`1234567890123.5`)
	assert.equal(
		await page.evaluate(() => window.polish.longValue()),
		1234567890123.5,
	)
	if (name === `narrow`)
		await page.screenshot({
			path: resolve(artifacts, `${theme}-${name}-long-number-${sizing}.png`),
		})
	await input.fill(`17`)
	await check(`17`)
	await forced?.evaluate((el) => el.remove())
	await original.dispose()
	return { sizing, samples }
}
await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
let browser
try {
	browser = await chromium.launch({
		chromiumSandbox: true,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
	})
	const report = {
		candidate: process.env.SPA_DEVTOOLS_CANDIDATE_SHA ?? `working-tree`,
		baseline,
		browser: browser.version(),
		reactVersions,
		matrix: [],
		flows: [],
		notes: [
			`200% desktop zoom is emulated with a 720x450 CSS viewport and deviceScaleFactor2 for 1440x900 physical pixels; browser chrome zoom is not automated.`,
		],
	}
	for (const theme of [`light`, `dark`])
		for (const [name, width, height, scale] of [
			[`desktop`, 1440, 900, 1],
			[`tablet`, 1024, 768, 1],
			[`narrow`, 390, 844, 1],
			[`zoom200`, 720, 450, 2],
		]) {
			const context = await browser.newContext({
				viewport: { width, height },
				deviceScaleFactor: scale,
				colorScheme: theme,
			})
			const page = await context.newPage()
			const errors = []
			page.on(`pageerror`, (e) => errors.push(e.message))
			await page.goto(`http://127.0.0.1:${server.address().port}`)
			await page.getByRole(`textbox`, { name: `count`, exact: true }).waitFor()
			const input = page.getByRole(`textbox`, { name: `message`, exact: true })
			const short = (await input.boundingBox()).width
			await input.fill(`a longer elastic string`)
			const long = (await input.boundingBox()).width
			const measurement = await input.evaluate((el) => ({
				width: el.getBoundingClientRect().width,
				fieldSizing: getComputedStyle(el).fieldSizing,
			}))
			if (!baseline)
				assert.ok(long > short + 40, `Input should grow: ${short} -> ${long}`)
			const longFields = []
			if (!baseline)
				for (const sizing of [`native`, `fallback`])
					longFields.push(await checkLongField(page, theme, name, sizing))
			if (!baseline) {
				const labels = await page
					.locator(`.toolbar > button`)
					.evaluateAll((buttons) =>
						buttons.map((button) => button.getAttribute(`aria-label`)),
					)
				assert.deepEqual(labels.slice(-3), [
					`Minimize debugger`,
					`Debugger layout`,
					`Hide debugger (Ctrl+Shift+A)`,
				])
				assert.equal(
					await page
						.locator(`.brand-mark`)
						.evaluate((el) => el.getAnimations().length),
					0,
				)
			}
			await page.getByRole(`textbox`, { name: `count`, exact: true }).fill(`2.`)
			await page.screenshot({
				path: resolve(artifacts, `${theme}-${name}-editor.png`),
			})
			await page.getByTestId(`view-transactions`).click()
			await page.evaluate(() => window.polish.run())
			await page.getByTestId(`open-close-transaction-my`).click()
			await page.getByText(`params:`, { exact: false }).first().waitFor()
			if (!baseline) {
				const hierarchy = await page
					.getByTestId(`transaction-my`)
					.evaluate((el) => ({
						label: el.querySelector(`:scope > header`).textContent,
						parent: el.getBoundingClientRect().x,
						child: el.querySelector(`.event`).getBoundingClientRect().x,
					}))
				assert.match(hierarchy.label, /transaction/)
				assert.ok(hierarchy.child > hierarchy.parent + 5)
			}
			await page.screenshot({
				path: resolve(artifacts, `${theme}-${name}-transactions.png`),
			})
			await page.getByTestId(`view-ecology`).click()
			await page.waitForFunction(
				() => document.querySelector(`.ecology`)?.dataset.ready === `true`,
			)
			const arrows = await page
				.locator(`path.ecology-edge`)
				.evaluateAll((paths) =>
					paths.map((path) => {
						const length = path.getTotalLength(),
							end = path.getPointAtLength(length),
							near = path.getPointAtLength(length - 3)
						const cards = [...document.querySelectorAll(`g[data-graph-id]`)].map(
							(card) => {
								const t = card.transform.baseVal[0].matrix
								return { x: t.e, y: t.f }
							},
						)
						const target = cards.find(
							(c) =>
								((Math.abs(end.x - c.x) < 0.1 ||
									Math.abs(end.x - c.x - 176) < 0.1) &&
									end.y >= c.y &&
									end.y <= c.y + 52) ||
								((Math.abs(end.y - c.y) < 0.1 ||
									Math.abs(end.y - c.y - 52) < 0.1) &&
									end.x >= c.x &&
									end.x <= c.x + 176),
						)
						return {
							endpointAtCardBoundary: !!target,
							approachOutsideCard:
								!!target &&
								!(
									near.x > target.x &&
									near.x < target.x + 176 &&
									near.y > target.y &&
									near.y < target.y + 52
								),
						}
					}),
				)
			if (!baseline)
				assert.ok(
					arrows.length >= 3 &&
						arrows.every(
							(a) => a.endpointAtCardBoundary && a.approachOutsideCard,
						),
					`Arrowhead must approach from outside its destination: ${JSON.stringify(arrows)}`,
				)
			await page.screenshot({
				path: resolve(artifacts, `${theme}-${name}-arrows.png`),
			})
			await page
				.getByRole(`button`, { name: `Debugger layout`, exact: true })
				.click()
			await page.screenshot({
				path: resolve(artifacts, `${theme}-${name}-layout.png`),
			})
			if (!baseline)
				for (const button of await page.locator(`.snap-palette button`).all()) {
					const box = await button.boundingBox()
					assert.ok(
						box.x >= 0 &&
							box.y >= 0 &&
							box.x + box.width <= width + 1 &&
							box.y + box.height <= height + 1,
					)
				}
			assert.deepEqual(errors, [])
			report.matrix.push({
				theme,
				name,
				viewport: { width, height },
				deviceScaleFactor: scale,
				shortWidth: short,
				longWidth: long,
				...measurement,
				arrows,
				longFields,
			})
			await context.close()
		}
	if (!baseline)
		for (const mode of [`spa`, `react18`, `react19`]) {
			const context = await browser.newContext({
				viewport: { width: 1024, height: 768 },
			})
			const page = await context.newPage()
			const errors = []
			page.on(`pageerror`, (e) => errors.push(e.message))
			await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`)
			const input = page.getByRole(`textbox`, { name: `count`, exact: true })
			await input.fill(`2.`)
			await input.evaluate((el) => {
				window.retainedInput = el
			})
			assert.equal(await page.evaluate(() => window.polish.value()), 2)
			await input.press(`5`)
			assert.equal(await input.inputValue(), `2.5`)
			assert.equal(await page.evaluate(() => window.polish.value()), 2.5)
			assert.equal(
				await input.evaluate((el) => getComputedStyle(el).textAlign),
				`right`,
			)
			const rows = await page
				.locator(`.state-leaf > .json-editor > header`)
				.evaluateAll((nodes) =>
					nodes.map((n) => n.getBoundingClientRect().height),
				)
			assert.ok(rows.every((h) => h === 22))
			// Native content sizing and character-count fallback both retain the live field.
			const message = page.getByRole(`textbox`, { name: `message`, exact: true })
			await page.addStyleTag({
				content: `main .elastic-input {field-sizing:fixed !important}`,
			})
			await message.fill(`x`)
			const smallFallback = (await message.boundingBox()).width
			await message.fill(`a much longer fallback string`)
			assert.ok((await message.boundingBox()).width > smallFallback + 80)
			await page
				.getByRole(`button`, { name: `Expand record`, exact: true })
				.click()
			const rename = page.getByRole(`textbox`, { name: `Rename a`, exact: true })
			await rename.fill(`b`)
			await rename.press(`Enter`)
			assert.match(await page.getByRole(`alert`).innerText(), /already exists/)
			await rename.fill(`alpha`)
			await rename.press(`Enter`)
			await page.getByRole(`textbox`, { name: `alpha`, exact: true }).waitFor()
			await page.getByRole(`checkbox`, { name: `flag`, exact: true }).check()
			await page
				.getByRole(`button`, { name: `Expand list`, exact: true })
				.click()
			await page.getByRole(`button`, { name: `sort`, exact: true }).click()
			await page.getByRole(`button`, { name: `add item`, exact: true }).click()
			await page.getByRole(`button`, { name: `Delete 2`, exact: true }).click()
			await page
				.getByRole(`combobox`, { name: `Type of alpha`, exact: true })
				.selectOption(`string`)
			await page
				.getByRole(`button`, { name: `add property`, exact: true })
				.click()
			await page.getByRole(`button`, { name: `Delete new`, exact: true }).click()
			assert.deepEqual(await page.evaluate(() => window.polish.record()), {
				alpha: `1`,
				b: 2,
				list: [1, 3],
				flag: true,
			})
			assert.ok(await page.locator(`[data-testid="state-circular"]`).innerText())
			assert.match(await page.getByTestId(`state-map`).innerText(), /Map/)
			await page.getByTestId(`open-close-state-family-items`).click()
			assert.equal(
				await page.locator(`[data-testid="state-items"] .state-leaf`).count(),
				1,
			)
			await page.getByRole(`button`, { name: /^Dispose items/ }).click()
			assert.equal(
				await page.locator(`[data-testid="state-items"] .state-leaf`).count(),
				0,
			)
			await page.getByTestId(`view-selectors`).click()
			assert.match(
				await page.getByTestId(`state-value-failed`).innerText(),
				/Example failure/,
			)
			assert.match(
				await page.getByTestId(`state-value-pending`).innerText(),
				/pending/,
			)
			assert.equal(
				await page
					.locator(`[data-testid="state-value-left"] input`)
					.getAttribute(`readonly`),
				``,
			)
			await page.screenshot({
				path: resolve(artifacts, `${mode}-selector-states.png`),
			})
			await page.getByTestId(`view-transactions`).click()
			await page.evaluate(() => window.polish.run())
			assert.equal(await page.evaluate(() => window.polish.value()), 3.5)
			await page.getByTestId(`view-timelines`).click()
			await page.getByTestId(`open-close-timeline-history`).click()
			await page.getByRole(`button`, { name: `undo`, exact: true }).click()
			assert.equal(await page.evaluate(() => window.polish.value()), 2.5)
			await page.getByRole(`button`, { name: `redo`, exact: true }).click()
			assert.equal(await page.evaluate(() => window.polish.value()), 3.5)
			const tabs = page.getByRole(`tab`)
			assert.equal(await tabs.count(), 5)
			await tabs.first().focus()
			await page.keyboard.press(`End`)
			await page.waitForFunction(
				() => document.querySelector(`.ecology`)?.dataset.ready === `true`,
			)
			const before = await page.evaluate(() => window.polish.evidence())
			await page.getByRole(`textbox`, { name: `Search ecology` }).fill(`left`)
			await page.waitForFunction(
				() => document.querySelector(`.ecology`)?.dataset.ready === `true`,
			)
			await page.getByText(`Accessible node list`, { exact: true }).click()
			await page.locator(`.ecology-list button`).first().focus()
			await page.keyboard.press(`Enter`)
			await page
				.getByRole(`button`, { name: `Trace observed roots`, exact: true })
				.focus()
			await page.keyboard.press(`Enter`)
			await page.waitForFunction(
				() => document.querySelector(`.ecology`)?.dataset.ready === `true`,
			)
			assert.deepEqual(
				await page.evaluate(() => window.polish.evidence()),
				before,
			)
			await page
				.getByRole(`button`, {
					name: `Open live editor (may read/evaluate)`,
					exact: true,
				})
				.click()
			assert.equal(
				await page.locator(`.ecology-inspector input`).getAttribute(`readonly`),
				``,
			)
			await page
				.getByRole(`button`, { name: `Debugger layout`, exact: true })
				.focus()
			await page.keyboard.press(`Enter`)
			await page.getByRole(`button`, { name: `Left half`, exact: true }).focus()
			await page.keyboard.press(`Enter`)
			assert.equal((await page.locator(`main`).boundingBox()).width, 512)
			await page.getByRole(`tab`).first().focus()
			await page.keyboard.press(`Home`)
			await page.getByRole(`textbox`, { name: `count`, exact: true }).waitFor()
			for (let i = 0; i < 10; i++) {
				await page.evaluate(() => {
					window.polish.dispose()
					window.polish.show()
				})
				await input.waitFor()
				assert.equal(await page.locator(`main`).count(), 1)
			}
			await page.evaluate(() => {
				window.polish.swap()
			})
			await input.waitFor()
			await page.waitForFunction(
				() => document.querySelector(`[aria-label="count"]`)?.value === `2`,
			)
			if (mode !== `spa`) {
				await page.evaluate(() => {
					window.polish.show(true)
				})
				await page.waitForFunction(
					() => document.querySelector(`[aria-label="count"]`)?.value === `3.5`,
				)
			}
			assert.deepEqual(errors, [])
			report.flows.push({ mode, passed: true, repeatedMounts: 10 })
			await context.close()
		}
	await writeFile(
		resolve(artifacts, `report.json`),
		JSON.stringify(report, null, 2),
	)
	console.log(JSON.stringify(report, null, 2))
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
