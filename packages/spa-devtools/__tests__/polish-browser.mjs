import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, resolve } from "node:path"
import { createRequire } from "node:module"
import { build } from "esbuild"
import { chromium } from "playwright"
const favicon = await readFile(
	resolve(import.meta.dirname, `../../../apps/atom.io.fyi/public/favicon.png`),
)
const faviconSha256 = createHash(`sha256`).update(favicon).digest(`hex`)
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
async function checkVisualTreatment(page, theme, name) {
	const icon = await page
		.locator(`.brand-mark`)
		.evaluate((el) => getComputedStyle(el).backgroundImage)
	const embedded = icon.match(/data:image\/png;base64,([^"')]+)/)
	assert.ok(embedded, `Use the linked PNG favicon, not another mark`)
	assert.deepEqual(Buffer.from(embedded[1], `base64`), favicon)
	const appearance = await page.locator(`main`).evaluate((el) => {
		const noise = getComputedStyle(el, `::before`),
			active = el.querySelector(`[role="tab"][aria-selected="true"]`),
			inactive = el.querySelector(`[role="tab"][aria-selected="false"]`),
			a = active.getBoundingClientRect(),
			b = inactive.getBoundingClientRect(),
			selected = getComputedStyle(active),
			rest = getComputedStyle(inactive)
		return {
			noise: {
				opacity: noise.opacity,
				blend: noise.mixBlendMode,
				size: noise.backgroundSize,
				repeat: noise.backgroundRepeat,
				position: noise.backgroundPosition,
				pointerEvents: noise.pointerEvents,
			},
			tabs: {
				activeTop: a.top,
				inactiveTop: b.top,
				activeBottom: a.bottom,
				inactiveBottom: b.bottom,
				radius: selected.borderTopLeftRadius,
				activeFill: selected.backgroundColor,
				activeBottomEdge: selected.borderBottomColor,
				panelFill: getComputedStyle(el.querySelector(`.index`)).backgroundColor,
				inactiveShadow: rest.boxShadow,
			},
			textColor: getComputedStyle(el).color,
		}
	})
	assert.equal(appearance.noise.opacity, theme === `dark` ? `1` : `0.5`)
	assert.equal(
		appearance.noise.blend,
		theme === `dark` ? `soft-light` : `multiply`,
	)
	assert.equal(appearance.noise.size, `1024px auto`)
	assert.equal(appearance.noise.repeat, `repeat`)
	assert.equal(appearance.noise.position, `50% 50%`)
	assert.equal(appearance.noise.pointerEvents, `none`)
	assert.ok(appearance.tabs.activeTop <= appearance.tabs.inactiveTop - 3)
	assert.ok(
		Math.abs(appearance.tabs.activeBottom - appearance.tabs.inactiveBottom) < 1,
	)
	assert.equal(appearance.tabs.activeBottomEdge, appearance.tabs.activeFill)
	assert.equal(appearance.tabs.activeFill, appearance.tabs.panelFill)
	assert.ok(parseFloat(appearance.tabs.radius) >= 7)
	assert.match(appearance.tabs.inactiveShadow, /inset/)
	const clip = await page.locator(`.index`).evaluate((el) => {
		const r = el.getBoundingClientRect()
		return { x: r.left + 16, y: r.bottom - 96, width: 80, height: 80 }
	})
	const on = await page.screenshot({
		clip,
		path: resolve(artifacts, `${theme}-${name}-noise.png`),
	})
	const off = await page.addStyleTag({
		content: `main[data-css="spa-devtools"]::before {display:none !important}`,
	})
	const flat = await page.screenshot({ clip })
	await off.evaluate((el) => {
		el.remove()
	})
	// Compare the same noise coordinates on the actual background and solid text-color ink.
	const probe = await page
		.locator(`main`)
		.evaluateHandle((panel, sampleRect) => {
			const node = document.createElement(`div`),
				r = panel.getBoundingClientRect()
			Object.assign(node.style, {
				position: `absolute`,
				left: `${sampleRect.x - r.left - panel.clientLeft}px`,
				top: `${sampleRect.y - r.top - panel.clientTop}px`,
				width: `${sampleRect.width}px`,
				height: `${sampleRect.height}px`,
				background: getComputedStyle(panel).color,
				zIndex: `9`,
				pointerEvents: `none`,
			})
			panel.append(node)
			return node
		}, clip)
	const ink = await page.screenshot({ clip })
	await probe.evaluate((el) => {
		el.remove()
	})
	await probe.dispose()
	const pixels = await page.evaluate(
		async ({ on: noisePng, flat: flatPng, ink: inkPng }) => {
			const read = async (data) => {
				const image = new Image()
				image.src = `data:image/png;base64,${data}`
				await image.decode()
				const canvas = document.createElement(`canvas`)
				canvas.width = image.width
				canvas.height = image.height
				const ctx = canvas.getContext(`2d`)
				ctx.drawImage(image, 0, 0)
				return ctx.getImageData(0, 0, image.width, image.height).data
			}
			const a = await read(noisePng),
				b = await read(flatPng),
				foreground = await read(inkPng)
			const linear = (v) => {
				const x = v / 255
				return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
			}
			const luminance = (data, i) =>
				0.2126 * linear(data[i]) +
				0.7152 * linear(data[i + 1]) +
				0.0722 * linear(data[i + 2])
			let minimumInkContrast = Infinity
			let delta = 0,
				sum = 0,
				squares = 0,
				min = 255,
				max = 0
			for (let i = 0; i < a.length; i += 4) {
				const luma = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]
				const bg = luminance(a, i),
					fg = luminance(foreground, i)
				minimumInkContrast = Math.min(
					minimumInkContrast,
					(Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05),
				)
				sum += luma
				squares += luma * luma
				min = Math.min(min, luma)
				max = Math.max(max, luma)
				delta +=
					(Math.abs(a[i] - b[i]) +
						Math.abs(a[i + 1] - b[i + 1]) +
						Math.abs(a[i + 2] - b[i + 2])) /
					3
			}
			const n = a.length / 4
			return {
				averageChannelDelta: delta / n,
				lumaStdDev: Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)),
				minLuma: min,
				maxLuma: max,
				minimumInkContrast,
			}
		},
		{
			on: on.toString(`base64`),
			flat: flat.toString(`base64`),
			ink: ink.toString(`base64`),
		},
	)
	assert.ok(
		pixels.averageChannelDelta > 1 && pixels.lumaStdDev > 0.5,
		`Noise must affect actual rendered pixels: ${JSON.stringify(pixels)}`,
	)
	assert.ok(
		pixels.minimumInkContrast >= 4.5,
		`Noise must retain text/background contrast in the sampled patch: ${JSON.stringify(pixels)}`,
	)
	return { faviconSha256, ...appearance, pixels }
}
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
			const visual = baseline
				? null
				: await checkVisualTreatment(page, theme, name)
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
				visual,
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
