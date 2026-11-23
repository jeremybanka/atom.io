import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import type { AddressInfo } from "node:net"
import { dirname, resolve } from "node:path"

import { build } from "esbuild"
import type { Browser, BrowserContext, Locator, Page } from "playwright"

import {
	browserArtifacts,
	cpuRate,
	launchBrowser,
	loadDevtoolsAssets,
} from "./browser-runtime.ts"

const baseline = process.argv.includes(`--baseline`)
const artifacts = browserArtifacts(
	process.env[`SPA_DEVTOOLS_POLISH_ARTIFACTS`] ?? `/tmp/devtools-polish`,
)
await mkdir(artifacts, { recursive: true })
const entry = resolve(import.meta.dirname, `fixtures/polish-browser/main.ts`)
const bundles: Record<string, string> = {}
const reactVersions: Record<string, string> = {}
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
const assets = await loadDevtoolsAssets()
const server = createServer((req, res) => {
	const url = new URL(req.url ?? `/`, `http://localhost`),
		prefix = url.pathname.startsWith(`/nested/consumer/`)
			? `/nested/consumer`
			: ``,
		pathname = url.pathname.slice(prefix.length),
		mode = url.searchParams.get(`mode`) ?? `spa`
	const asset = assets.get(pathname)
	if (asset) {
		res.setHeader(`content-type`, asset.type)
		res.end(asset.body)
		return
	}
	res.setHeader(
		`content-type`,
		bundles[pathname] ? `application/javascript` : `text/html`,
	)
	res.end(
		bundles[pathname] ??
			`<link rel="stylesheet" href="${prefix}/devtools.css"><script type="module" src="${prefix}/${mode}.js"></script>`,
	)
})
async function checkTypography(page: Page, prefix: string) {
	const typography = await page.evaluate(async () => {
		const loaded = await Promise.all(
			[200, 400, 500].map((weight) =>
				document.fonts.load(`${weight} 14px "Atom IO Theia"`),
			),
		)
		await document.fonts.ready
		const panel = document.querySelector<HTMLElement>(
				`debugger-panel[data-css="devtools"]`,
			)!,
			title = panel.querySelector(`h1`)!
		return {
			loaded: loaded.map((faces) =>
				faces.map((face) => ({
					family: face.family,
					weight: face.weight,
					status: face.status,
				})),
			),
			family: getComputedStyle(panel).fontFamily,
			body: getComputedStyle(panel).fontWeight,
			header: getComputedStyle(title).fontWeight,
			requests: performance
				.getEntriesByType(`resource`)
				.map((resource) => resource.name)
				.filter((name) => name.includes(`Theia0.3`)),
		}
	})
	assert.match(typography.family, /Atom IO Theia/)
	assert.equal(typography.body, `400`)
	assert.equal(typography.header, `200`)
	for (const [index, weight] of [200, 400, 500].entries()) {
		assert.deepEqual(
			typography.loaded[index].map((face) => ({
				weight: face.weight,
				status: face.status,
			})),
			[{ weight: String(weight), status: `loaded` }],
		)
		assert.ok(
			typography.requests.some(
				(url) =>
					new URL(url).pathname === `${prefix}/fonts/Theia0.3-${weight}.otf`,
			),
		)
	}
	return typography
}
async function checkEditorIconAlignment(root: Locator, expected: string[]) {
	const icons = await root
		.locator(`svg[data-editor-icon]:visible`)
		.evaluateAll((elements: SVGSVGElement[]) =>
			elements.map((icon) => {
				const row = icon.closest(`editor-row, editor-actions, node-heading`)!
				const button = icon.closest(`button`)!
				const center = (element: Element) => {
					const { top, height } = element.getBoundingClientRect()
					return top + height / 2
				}
				const path = icon.querySelector(`path`)!
				const box = path.getBBox()
				const ink = new DOMPoint(8, box.y + box.height / 2).matrixTransform(
					path.getScreenCTM()!,
				).y
				return {
					name: icon.dataset[`editorIcon`],
					buttonOffset: center(button) - center(row),
					inkOffset: ink - center(row),
				}
			}),
		)
	for (const name of expected)
		assert.ok(
			icons.some((icon) => icon.name === name),
			`Missing ${name} icon`,
		)
	for (const icon of icons) {
		assert.ok(Math.abs(icon.buttonOffset) < 0.25, JSON.stringify(icon))
		assert.ok(Math.abs(icon.inkOffset) < 0.25, JSON.stringify(icon))
	}
}
async function checkVisualTreatment(
	page: Page,
	theme: `light` | `dark`,
	name: string,
) {
	const typography = await checkTypography(page, ``)
	await page.waitForSelector(`brand-mark[data-live="true"] canvas`)
	const icon = await page
		.locator(`brand-mark`)
		.evaluate(async (el: HTMLElement) => {
			el.setAttribute(`data-live`, `false`)
			const background = getComputedStyle(el).backgroundImage
			el.setAttribute(`data-live`, `true`)
			const urls = [...background.matchAll(/url\("([^"]+)"\)/g)]
			return Promise.all(
				urls.map(async ([, url]) => {
					const image = new Image()
					image.src = url
					await image.decode()
					return {
						file: new URL(url).pathname.split(`/`).at(-1),
						width: image.naturalWidth,
						height: image.naturalHeight,
					}
				}),
			)
		})
	assert.deepEqual(icon, [
		{ file: `mark-32.webp`, width: 32, height: 32 },
		{ file: `mark-32@2x.webp`, width: 64, height: 64 },
	])
	const appearance = await page
		.locator(`debugger-panel`)
		.evaluate((el: HTMLElement) => {
			const noise = getComputedStyle(el, `::before`),
				active = el.querySelector<HTMLElement>(
					`[role="tab"][aria-selected="true"]`,
				)!,
				inactive = el.querySelector<HTMLElement>(
					`[role="tab"][aria-selected="false"]`,
				)!,
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
					contentTop: el
						.querySelector(`debugger-content`)!
						.getBoundingClientRect().top,
					inactiveBottom: b.bottom,
					radius: selected.borderTopLeftRadius,
					activeFill: selected.backgroundColor,
					activeBottomEdge: selected.borderBottomColor,
					inactiveShadow: rest.boxShadow,
				},
				textColor: getComputedStyle(el).color,
				surfaces: {
					shell: getComputedStyle(
						el.querySelector(`debugger-toolbar`)!,
						`::before`,
					).backgroundColor,
					content: getComputedStyle(el.querySelector(`debugger-content`)!)
						.backgroundColor,
					inactive: rest.backgroundColor,
					hard: getComputedStyle(el).getPropertyValue(`--bg-hard-1`).trim(),
					shade: getComputedStyle(el).getPropertyValue(`--bg-shade-1`).trim(),
					tint: getComputedStyle(el).getPropertyValue(`--bg-tint-1`).trim(),
				},
			}
		})
	assert.notEqual(appearance.surfaces.shell, appearance.surfaces.content)
	assert.match(appearance.surfaces.shell, / \/ 0\.92\)$/)
	assert.match(appearance.surfaces.content, / \/ 0\.92\)$/)
	assert.match(appearance.surfaces.inactive, / \/ 0\.92\)$/)
	assert.notEqual(appearance.surfaces.content, appearance.surfaces.inactive)
	assert.equal(
		appearance.surfaces.hard,
		theme === `dark` ? appearance.surfaces.shade : appearance.surfaces.tint,
	)
	assert.equal(appearance.noise.opacity, theme === `dark` ? `0.35` : `0.12`)
	assert.equal(
		appearance.noise.blend,
		theme === `dark` ? `soft-light` : `multiply`,
	)
	assert.match(appearance.noise.size, /^1024px(?: auto)?$/)
	assert.equal(appearance.noise.repeat, `repeat`)
	assert.equal(appearance.noise.position, `50% 50%`)
	assert.equal(appearance.noise.pointerEvents, `none`)
	assert.ok(appearance.tabs.activeTop <= appearance.tabs.inactiveTop - 3)
	assert.ok(
		Math.abs(appearance.tabs.activeBottom - appearance.tabs.inactiveBottom) < 1,
	)
	assert.equal(appearance.tabs.activeFill, appearance.surfaces.content)
	assert.equal(appearance.tabs.activeBottomEdge, `rgba(0, 0, 0, 0)`)
	assert.ok(
		Math.abs(appearance.tabs.activeBottom - appearance.tabs.contentTop) < 1,
	)
	assert.ok(parseFloat(appearance.tabs.radius) >= 7)
	assert.equal(appearance.tabs.inactiveShadow, `none`)
	const clip = await page.locator(`[data-index]`).evaluate((el: HTMLElement) => {
		const r = el.getBoundingClientRect()
		return { x: r.left + 16, y: r.bottom - 96, width: 80, height: 80 }
	})
	const on = await page.screenshot({
		clip,
		path: resolve(artifacts, `${theme}-${name}-noise.png`),
	})
	const off = await page.addStyleTag({
		content: `debugger-panel[data-css="devtools"]::before {display:none !important}`,
	})
	const flat = await page.screenshot({ clip })
	const tabJoin = await page
		.getByRole(`tab`, { selected: true })
		.evaluate((tab) => {
			const bounds = tab.getBoundingClientRect()
			const strip = tab.closest(`nav`)!.getBoundingClientRect()
			const x = Math.ceil(strip.left) + 1
			const dividerRow = 2
			return {
				clip: {
					x,
					y: Math.floor(bounds.bottom - 0.5) - dividerRow,
					width: Math.floor(strip.right) - x - 1,
					height: 7,
				},
				dividerRow,
				openStart: Math.round(bounds.left) - x + 1,
				openEnd: Math.round(bounds.right) - x - 1,
				stroke: getComputedStyle(tab).borderTopColor.match(/\d+/g)!.map(Number),
			}
		})
	const seamCapture = { clip: tabJoin.clip, scale: `css` } as const
	const backing = await page.addStyleTag({
		content: `html, body { background: black }`,
	})
	const darkBacking = await page.screenshot({ clip })
	const lightThemeSeam =
		theme === `light` ? await page.screenshot(seamCapture) : undefined
	await backing.evaluate((style) => {
		style.textContent = `html, body { background: white }`
	})
	const lightBacking = await page.screenshot({ clip })
	const seam = lightThemeSeam ?? (await page.screenshot(seamCapture))
	await backing.evaluate((style: HTMLStyleElement) => {
		style.remove()
	})
	await off.evaluate((el: HTMLElement) => {
		el.remove()
	})
	// Compare the same noise coordinates on the actual background and solid text-color ink.
	const probe = await page
		.locator(`debugger-panel`)
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
	await probe.evaluate((el: HTMLElement) => {
		el.remove()
	})
	await probe.dispose()
	const pixels = await page.evaluate(
		async ({
			on: noisePng,
			flat: flatPng,
			ink: inkPng,
			darkBackingPng,
			lightBackingPng,
			seamPng,
			join,
		}) => {
			const read = async (data: string) => {
				const image = new Image()
				image.src = `data:image/png;base64,${data}`
				await image.decode()
				const canvas = document.createElement(`canvas`)
				canvas.width = image.width
				canvas.height = image.height
				const ctx = canvas.getContext(`2d`)
				if (!ctx) throw new Error(`Missing ctx`)
				ctx.drawImage(image, 0, 0)
				return ctx.getImageData(0, 0, image.width, image.height).data
			}
			const a = await read(noisePng),
				b = await read(flatPng),
				foreground = await read(inkPng),
				dark = await read(darkBackingPng),
				light = await read(lightBackingPng)
			const linear = (v: number) => {
				const x = v / 255
				return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
			}
			const luminance = (data: Uint8ClampedArray, i: number) =>
				0.2126 * linear(data[i]) +
				0.7152 * linear(data[i + 1]) +
				0.0722 * linear(data[i + 2])
			let minimumInkContrast = Infinity
			let delta = 0,
				backingDelta = 0,
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
				backingDelta += light[i] - dark[i]
				delta +=
					(Math.abs(a[i] - b[i]) +
						Math.abs(a[i + 1] - b[i + 1]) +
						Math.abs(a[i + 2] - b[i + 2])) /
					3
			}
			const n = a.length / 4
			const seamPixels = await read(seamPng)
			const { width, height } = join.clip
			const sample = (x: number, y: number, channel: number) =>
				seamPixels[(y * width + x) * 4 + channel]
			let dividerDelta = 0
			for (let x = 0; x < width; x++) {
				if (x >= join.openStart && x < join.openEnd) continue
				for (let channel = 0; channel < 3; channel++)
					dividerDelta = Math.max(
						dividerDelta,
						Math.abs(sample(x, join.dividerRow, channel) - join.stroke[channel]),
					)
			}
			let seamDelta = 0
			for (let x = join.openStart + 7; x < join.openStart + 11; x++)
				for (let y = 0; y < height - 1; y++)
					for (let channel = 0; channel < 3; channel++)
						seamDelta = Math.max(
							seamDelta,
							Math.abs(sample(x, y, channel) - sample(x, height - 1, channel)),
						)
			return {
				averageChannelDelta: delta / n,
				backingDelta: backingDelta / n,
				seamDelta,
				dividerDelta,
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
			darkBackingPng: darkBacking.toString(`base64`),
			lightBackingPng: lightBacking.toString(`base64`),
			seamPng: seam.toString(`base64`),
			join: tabJoin,
		},
	)
	assert.ok(
		pixels.backingDelta >= 18 && pixels.backingDelta <= 22,
		`The page should contribute about 8% of the visible window fill: ${pixels.backingDelta}`,
	)
	assert.ok(
		pixels.seamDelta <= 2,
		`The selected tab should blend into the content: ${pixels.seamDelta}`,
	)
	assert.ok(
		pixels.dividerDelta <= 2,
		`The content edge should meet both active corners and cover the inactive corners: ${pixels.dividerDelta}`,
	)
	assert.ok(
		pixels.averageChannelDelta > 1 && pixels.lumaStdDev > 0.5,
		`Noise must affect actual rendered pixels: ${JSON.stringify(pixels)}`,
	)
	assert.ok(
		pixels.minimumInkContrast >= 4.5,
		`Noise must retain text/background contrast in the sampled patch: ${JSON.stringify(pixels)}`,
	)
	return { icon, typography, ...appearance, pixels }
}
function contrastRatio(ink: string, fill: string): number {
	const luminance = (color: string) =>
		color
			.match(/\d+/g)!
			.slice(0, 3)
			.map(Number)
			.map((channel) => {
				const v = channel / 255
				return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
			})
			.reduce(
				(sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index],
				0,
			)
	const a = luminance(ink),
		b = luminance(fill)
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
async function checkLayering(page: Page, theme: `light` | `dark`) {
	await page.getByTestId(`view-atoms`).click()
	// Close any layout menu left by the viewport checks before exercising search Escape.
	await page.keyboard.press(`Escape`)
	for (const key of [`nested`, `level1`, `level2`, `level3`, `level4`, `level5`])
		await page
			.getByRole(`button`, { name: `Expand ${key}`, exact: true })
			.click()
	const rows = await page
		.getByTestId(`state-value-nested`)
		.locator(`json-editor`)
		.evaluateAll((editors) =>
			editors.map((editor) => {
				const row = editor.querySelector<HTMLElement>(`:scope > editor-row`)!
				return {
					depth: Number(editor.getAttribute(`data-depth`)),
					fill: getComputedStyle(row).backgroundColor,
					height: row.getBoundingClientRect().height,
				}
			}),
		)
	assert.deepEqual(
		rows.map((row) => row.depth),
		[0, 1, 2, 3, 3, 3, 3],
	)
	assert.equal(rows[0].height, 22)
	assert.ok(rows.slice(1).every((row) => row.height === 21))
	assert.notEqual(rows[0].fill, rows[1].fill)
	assert.notEqual(rows[1].fill, rows[2].fill)
	assert.ok(rows.slice(2).every((row) => row.fill === rows[2].fill))
	await page.getByRole(`button`, { name: `Expand record`, exact: true }).click()
	const rename = page.getByRole(`textbox`, { name: `Rename a`, exact: true })
	await rename.fill(`b`)
	await rename.press(`Enter`)
	await page.getByRole(`alert`).waitFor()
	const error = await page.getByRole(`alert`).evaluate((node) => ({
		ink: getComputedStyle(node).color,
		fill: getComputedStyle(node).backgroundColor,
	}))
	const errorContrast = contrastRatio(error.ink, error.fill)
	assert.ok(errorContrast >= 4.5)
	await page.screenshot({ path: resolve(artifacts, `${theme}-error-state.png`) })
	const amount = page.getByRole(`textbox`, { name: `amount`, exact: true })
	await amount.fill(`7.`)
	assert.equal(
		await amount.inputValue(),
		`7.`,
		`Draft must survive the nested edit itself`,
	)
	const focus = await amount.evaluate((node) => ({
		focused: document.activeElement === node,
		outline: getComputedStyle(node).outlineWidth,
		ink: getComputedStyle(node).outlineColor,
		fill: getComputedStyle(node).backgroundColor,
	}))
	assert.equal(focus.focused, true)
	assert.equal(focus.outline, `2px`)
	const focusContrast = contrastRatio(focus.ink, focus.fill)
	assert.ok(focusContrast >= 3)
	await page.screenshot({
		path: resolve(artifacts, `${theme}-surfaces-nested.png`),
	})
	return { rows, error, errorContrast, focus, focusContrast }
}
async function checkLongField(
	page: Page,
	theme: `light` | `dark`,
	name: string,
	sizing: string,
) {
	const input = page.locator(`input[aria-label^="a very long key"]`)
	const original = await input.elementHandle()
	const forced =
		sizing === `fallback`
			? await page.addStyleTag({
					content: `debugger-panel [data-elastic-input] {field-sizing:fixed !important}`,
				})
			: null
	const samples: unknown[] = []
	const check = async (expected: string) => {
		const measurement = await input.evaluate((el: HTMLInputElement) => {
			const bounds = (node: Element) => {
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
			const wrapper = el.parentElement!,
				row = el.closest(`editor-row`)!,
				panel = el.closest(`debugger-panel`)!,
				label = row.querySelector<HTMLElement>(`field-name h3`)!,
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
		const fits = (
			inner: Pick<DOMRect, `left` | `right` | `top` | `bottom`>,
			outer: Pick<DOMRect, `left` | `right` | `top` | `bottom`>,
		) =>
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
				(el: HTMLElement) => el.isConnected && el === document.activeElement,
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
	await forced?.evaluate((el: HTMLElement) => {
		el.remove()
	})
	await original.dispose()
	return { sizing, samples }
}
await new Promise<void>((ready) => server.listen(0, `127.0.0.1`, ready))
let browser: Browser | undefined
try {
	browser = await launchBrowser({ softwareWebGL: true })
	const report = {
		cpuRate,
		candidate: process.env[`SPA_DEVTOOLS_CANDIDATE_SHA`] ?? `working-tree`,
		baseline,
		browser: browser.version(),
		reactVersions,
		matrix: [] as unknown[],
		flows: [] as unknown[],
		notes: [
			`200% desktop zoom is emulated with a 720x450 CSS viewport and deviceScaleFactor2 for 1440x900 physical pixels; browser chrome zoom is not automated.`,
		],
	}
	for (const theme of [`light`, `dark`] as const)
		for (const [name, width, height, scale] of [
			[`desktop`, 1440, 900, 1],
			[`tablet`, 1024, 768, 1],
			[`narrow`, 390, 844, 1],
			[`zoom200`, 720, 450, 2],
		] as const) {
			const context: BrowserContext = await browser.newContext({
				viewport: { width, height },
				deviceScaleFactor: scale,
				colorScheme: theme,
			})
			const page: Page = await context.newPage()
			const errors: string[] = []
			page.on(`pageerror`, (e) => errors.push(e.message))
			await page.goto(
				`http://127.0.0.1:${(server.address() as AddressInfo).port}`,
			)
			await page.getByRole(`textbox`, { name: `count`, exact: true }).waitFor()
			await checkTypography(page, ``)
			const input = page.getByRole(`textbox`, { name: `message`, exact: true })
			const short = (await input.boundingBox())!.width
			await input.fill(`a longer elastic string`)
			const long = (await input.boundingBox())!.width
			const measurement = await input.evaluate((el: HTMLElement) => ({
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
					.locator(`debugger-toolbar > button`)
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
						.locator(`brand-mark`)
						.evaluate((el: HTMLElement) => el.getAnimations().length),
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
					.evaluate((el: HTMLElement) => ({
						label: el.querySelector<HTMLElement>(
							`:scope > :is(node-heading,event-heading)`,
						)!.textContent,
						parent: el.getBoundingClientRect().x,
						child: el
							.querySelector<HTMLElement>(`event-view`)!
							.getBoundingClientRect().x,
					}))
				assert.match(hierarchy.label, /transaction/)
				assert.ok(hierarchy.child > hierarchy.parent + 5)
			}
			await page.screenshot({
				path: resolve(artifacts, `${theme}-${name}-transactions.png`),
			})
			await page.getByTestId(`view-ecology`).click()
			await page.waitForFunction(
				() =>
					document.querySelector<HTMLElement>(`ecology-view`)?.dataset[
						`ready`
					] === `true`,
			)
			if (baseline) {
				const capture = page.locator(`ecology-view details[data-capture]`)
				const disclosure = capture.locator(`summary`)
				await disclosure.focus()
				await disclosure.press(`Enter`)
				assert.equal(
					await capture.evaluate((node: HTMLDetailsElement) => node.open),
					true,
				)
				assert.equal(
					await page.locator(`ecology-view [data-legend]`).isVisible(),
					true,
				)
				await disclosure.press(`Enter`)
				assert.equal(
					await capture.evaluate((node: HTMLDetailsElement) => node.open),
					false,
				)
			} else {
				await checkEditorIconAlignment(page.locator(`ecology-editor`), [
					`expand`,
					`generate`,
					`reset`,
				])
				const guideTrigger = page.getByRole(`button`, {
					name: `Ecology guide`,
					exact: true,
				})
				await guideTrigger.focus()
				await guideTrigger.press(`Enter`)
				const guide = page.locator(`[data-guide-modal]`)
				assert.equal(
					await guide.evaluate((node) => node.matches(`:modal`)),
					true,
				)
				assert.match(await guide.innerText(), /Capture details & legend/)
				await page.screenshot({
					path: resolve(artifacts, `${theme}-${name}-guide.png`),
				})
				await page.keyboard.press(`Escape`)
				assert.equal(await guide.isVisible(), false)
				assert.equal(
					await guideTrigger.evaluate((node) => node === document.activeElement),
					true,
				)
			}
			if (!baseline) {
				await page.waitForFunction(
					() =>
						Number(
							document.querySelector<HTMLElement>(`ecology-scene`)?.dataset[
								`edges`
							],
						) >= 3,
				)
				assert.equal(
					await page.locator(`ecology-scene canvas`).isVisible(),
					true,
				)
				assert.equal(
					await page.locator(`ecology-scene`).getAttribute(`data-unavailable`),
					`false`,
				)
			}
			const edgeCount = baseline
				? null
				: await page.locator(`ecology-scene`).getAttribute(`data-edges`)
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
				for (const button of await page.locator(`snap-palette button`).all()) {
					const box = await button.boundingBox()
					if (!box) throw new Error(`Missing box`)
					assert.ok(
						box.x >= 0 &&
							box.y >= 0 &&
							box.x + box.width <= width + 1 &&
							box.y + box.height <= height + 1,
					)
				}
			const layering =
				name === `desktop` ? await checkLayering(page, theme) : null
			assert.deepEqual(errors, [])
			report.matrix.push({
				layering,
				theme,
				name,
				viewport: { width, height },
				deviceScaleFactor: scale,
				shortWidth: short,
				longWidth: long,
				...measurement,
				edges: edgeCount,
				longFields,
				visual,
			})
			if (!baseline && width === 390) {
				await page.keyboard.press(`Escape`)
				await page.getByTestId(`view-selectors`).click()
				const error = page
					.getByTestId(`state-value-failed`)
					.locator(`json-primitive code`)
				assert.match(await error.innerText(), /Error: Example failure/)
				await error.focus()
				await error.press(`ArrowRight`)
				await page.waitForFunction(
					() =>
						document.querySelector<HTMLElement>(
							`[data-testid="state-value-failed"] code`,
						)!.scrollLeft > 0,
				)
				assert.equal(
					await error.evaluate((node) => getComputedStyle(node).outlineWidth),
					`2px`,
				)
				await error.evaluate((node) => {
					node.scrollLeft = 0
				})
				const session = await context.newCDPSession(page)
				await session.send(`Emulation.setTouchEmulationEnabled`, {
					enabled: true,
				})
				const rect = (await error.boundingBox())!
				const touch = (x: number) => [{ x, y: rect.y + rect.height / 2 }]
				await session.send(`Input.dispatchTouchEvent`, {
					type: `touchStart`,
					touchPoints: touch(rect.x + rect.width - 4),
				})
				for (let step = 1; step <= 5; step++)
					await session.send(`Input.dispatchTouchEvent`, {
						type: `touchMove`,
						touchPoints: touch(
							rect.x + rect.width - 4 - ((rect.width - 8) * step) / 5,
						),
					})
				await session.send(`Input.dispatchTouchEvent`, {
					type: `touchEnd`,
					touchPoints: [],
				})
				await page.waitForFunction(
					() =>
						document.querySelector<HTMLElement>(
							`[data-testid="state-value-failed"] code`,
						)!.scrollLeft > 0,
				)
				await page.screenshot({
					path: resolve(artifacts, `${theme}-narrow-readable-error.png`),
				})
				await session.detach()
			}
			await context.close()
		}
	if (!baseline)
		for (const { prefix, mode } of [``, `/nested/consumer`].flatMap((base) =>
			[`spa`, `react18`, `react19`].map((consumer) => ({
				prefix: base,
				mode: consumer,
			})),
		)) {
			const context: BrowserContext = await browser.newContext({
				viewport: { width: 1024, height: 768 },
			})
			const page: Page = await context.newPage()
			const errors: string[] = []
			page.on(`pageerror`, (e) => errors.push(e.message))
			await page.goto(
				`http://127.0.0.1:${(server.address() as AddressInfo).port}${prefix}/?mode=${mode}`,
			)
			const input = page.getByRole(`textbox`, { name: `count`, exact: true })
			await input.waitFor()
			const typography = await checkTypography(page, prefix)
			await input.fill(`2.`)
			await input.evaluate((el: HTMLElement) => {
				window.retainedInput = el
			})
			assert.equal(await page.evaluate(() => window.polish.value()), 2)
			await input.press(`5`)
			assert.equal(await input.inputValue(), `2.5`)
			assert.equal(await page.evaluate(() => window.polish.value()), 2.5)
			assert.equal(
				await input.evaluate(
					(el: HTMLElement) => getComputedStyle(el).textAlign,
				),
				`right`,
			)
			const rows = await page
				.locator(
					`state-leaf > json-editor > :is(editor-row,node-heading,event-heading)`,
				)
				.evaluateAll((nodes) =>
					nodes.map((n) => n.getBoundingClientRect().height),
				)
			assert.ok(rows.every((h) => h === 22))
			// Native content sizing and character-count fallback both retain the live field.
			const message = page.getByRole(`textbox`, {
				name: `message`,
				exact: true,
			})
			await page.addStyleTag({
				content: `debugger-panel [data-elastic-input] {field-sizing:fixed !important}`,
			})
			await message.fill(`x`)
			const smallFallback = (await message.boundingBox())!.width
			await message.fill(`a much longer fallback string`)
			assert.ok((await message.boundingBox())!.width > smallFallback + 80)
			await page
				.getByRole(`button`, { name: `Expand record`, exact: true })
				.click()
			const rename = page.getByRole(`textbox`, {
				name: `Rename a`,
				exact: true,
			})
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
			await checkEditorIconAlignment(page.locator(`state-index`), [
				`add`,
				`collapse`,
				`remove`,
				`reorder`,
				`reset`,
				`sort`,
			])
			await page.getByRole(`button`, { name: `Sort`, exact: true }).click()
			await page.getByRole(`button`, { name: `Add item`, exact: true }).click()
			await page.getByRole(`button`, { name: `Delete 2`, exact: true }).click()
			await page
				.getByRole(`combobox`, { name: `Type of alpha`, exact: true })
				.press(`ArrowUp`)
			const handle = (index: number) =>
				page.getByRole(`button`, { name: `Reorder item ${index}`, exact: true })
			await handle(0).dragTo(handle(1))
			assert.deepEqual(
				await page.evaluate(() => window.polish.record()[`list`]),
				[3, 1],
			)
			await handle(1).press(`Alt+ArrowUp`)
			await page
				.getByRole(`button`, { name: `Add property`, exact: true })
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
				await page.locator(`[data-testid="state-items"] state-leaf`).count(),
				1,
			)
			await page.getByRole(`button`, { name: /^Dispose items/ }).click()
			assert.equal(
				await page.locator(`[data-testid="state-items"] state-leaf`).count(),
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
			await page.keyboard.press(`Home`)
			await page.waitForFunction(
				() =>
					document.querySelector<HTMLElement>(`ecology-view`)?.dataset[
						`ready`
					] === `true`,
			)
			const before = await page.evaluate(() => window.polish.evidence())
			const ecologySearch = page.getByRole(`searchbox`, {
				name: `Search ecology`,
			})
			if (!(await ecologySearch.isVisible()))
				await page.locator(`ecology-toolbar [data-action="search"]`).click()
			await ecologySearch.fill(`left`)
			await page.waitForFunction(
				() =>
					document.querySelector<HTMLElement>(`ecology-view`)?.dataset[
						`ready`
					] === `true`,
			)
			if (
				await ecologySearch.evaluate((node) =>
					node.closest(`dialog`)!.matches(`:modal`),
				)
			)
				await ecologySearch.press(`Escape`)
			await page
				.locator(`ecology-editor-row:not([hidden]) button[data-graph-id]`)
				.first()
				.focus()
			assert.equal(
				await page.locator(`ecology-view [data-results]`).isVisible(),
				false,
				`Search results close when focus moves into the editor`,
			)
			await page.keyboard.press(`Enter`)
			await page.waitForFunction(
				() =>
					document.querySelector<HTMLElement>(`ecology-view`)?.dataset[
						`ready`
					] === `true`,
			)
			assert.deepEqual(
				await page.evaluate(() => window.polish.evidence()),
				before,
			)
			assert.equal(
				await page
					.locator(`ecology-editor input[aria-label="left"]`)
					.getAttribute(`readonly`),
				``,
			)
			await page
				.getByRole(`button`, { name: `Debugger layout`, exact: true })
				.focus()
			await page.keyboard.press(`Enter`)
			await page.getByRole(`button`, { name: `Left half`, exact: true }).focus()
			await page.keyboard.press(`Enter`)
			assert.equal(
				(await page.locator(`debugger-panel`).boundingBox())!.width,
				512,
			)
			await page.getByRole(`tab`).first().focus()
			await page.keyboard.press(`Home`)
			await page.keyboard.press(`ArrowRight`)
			await page.getByRole(`textbox`, { name: `count`, exact: true }).waitFor()
			for (let i = 0; i < 10; i++) {
				await page.evaluate(() => {
					window.polish.dispose()
					window.polish.show()
				})
				await input.waitFor()
				assert.equal(await page.locator(`debugger-panel`).count(), 1)
			}
			await page.evaluate(() => {
				window.polish.swap()
			})
			await input.waitFor()
			await page.waitForFunction(
				() =>
					document.querySelector<HTMLInputElement>(`[aria-label="count"]`)
						?.value === `2`,
			)
			if (mode !== `spa`) {
				await page.evaluate(() => {
					window.polish.show(true)
				})
				await page.waitForFunction(
					() =>
						document.querySelector<HTMLInputElement>(`[aria-label="count"]`)
							?.value === `3.5`,
				)
			}
			assert.deepEqual(errors, [])
			report.flows.push({
				mode,
				prefix,
				typography,
				passed: true,
				repeatedMounts: 10,
			})
			await context.close()
		}
	await writeFile(
		resolve(artifacts, `report.json`),
		JSON.stringify(report, null, 2),
	)
	process.stdout.write(JSON.stringify(report, null, 2) + `\n`)
} finally {
	await browser?.close()
	await new Promise<void>((done) =>
		server.close(() => {
			done()
		}),
	)
}
