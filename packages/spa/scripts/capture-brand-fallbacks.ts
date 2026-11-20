import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "esbuild"
import { chromium } from "playwright"

const root = resolve(import.meta.dirname, `..`)
const output = resolve(root, `src/brand-fallback`)
const css = await readFile(resolve(root, `dist/brand.css`), `utf8`)
const cases = [
	{ name: `mark`, size: 180 },
	{ name: `mark-22`, size: 22 },
	{ name: `mark-22@2x`, size: 22, dpr: 2 },
	{ name: `mark-32`, size: 32 },
	{ name: `mark-32@2x`, size: 32, dpr: 2 },
	{ name: `mark-45`, size: 45 },
	{ name: `mark-45@2x`, size: 45, dpr: 2 },
	{ name: `splash`, viewport: 768 },
	{ name: `splash-narrow`, viewport: 640, dpr: 1.2 },
]

// Build the package first and install Chromium and cwebp before recapturing.
const {
	outputFiles: [bundle],
} = await build({
	absWorkingDir: root,
	stdin: {
		contents: `
			import { BrandMark } from '@atom.io/spa/brand'
			import { jsx } from '@atom.io/spa/jsx-runtime'
			import { render } from '@atom.io/spa'
			const params = new URL(location.href).searchParams
			const size = Number(params.get('size'))
			render(() => jsx(BrandMark, size ? { size } : { variant: 'splash' }), document.body)
		`,
		resolveDir: root,
	},
	bundle: true,
	format: `esm`,
	tsconfigRaw: {},
	write: false,
})

const executablePath = process.env[`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`]
const browser = await chromium.launch({
	...(executablePath ? { executablePath } : {}),
	args: [`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`],
})
try {
	await mkdir(output, { recursive: true })
	for (const { name, size, viewport = 800, dpr = 1 } of cases) {
		const page = await browser.newPage({
			viewport: { width: viewport, height: viewport },
			deviceScaleFactor: dpr,
			reducedMotion: `reduce`,
		})
		await page.addInitScript(() => {
			// Retain the completed frame for export after the browser composites it.
			const getContext = HTMLCanvasElement.prototype.getContext
			HTMLCanvasElement.prototype.getContext = function (
				this: HTMLCanvasElement,
				type,
				options,
			) {
				return getContext.call(this, type, {
					...options,
					preserveDrawingBuffer: true,
				})
			} as typeof getContext
		})
		await page.route(
			(url) => url.host === `brand.test` && url.pathname === `/`,
			(route) =>
				route.fulfill({
					contentType: `text/html`,
					body: `<!doctype html><style>${css}\nbrand-mark { background-image: none !important; }</style><script type="module" src="/brand.js"></script>`,
				}),
		)
		await page.route(`https://brand.test/brand.js`, (route) =>
			route.fulfill({
				contentType: `application/javascript`,
				body: bundle.text,
			}),
		)
		await page.goto(`https://brand.test/?size=${size ?? 0}`)
		const image = await page
			.locator(`brand-mark[data-live="true"] canvas`)
			.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
		assert.match(image, /^data:image\/png;base64,/)
		const png = Buffer.from(image.split(`,`)[1], `base64`)
		const pixels = Math.floor((size ?? viewport * 2) * dpr)
		assert.equal(png.readUInt32BE(16), pixels)
		assert.equal(png.readUInt32BE(20), pixels)
		const webp = spawnSync(
			`cwebp`,
			[`-quiet`, `-lossless`, `-o`, `-`, `--`, `-`],
			{
				input: png,
			},
		)
		if (webp.error) throw webp.error
		assert.equal(webp.status, 0, webp.stderr.toString())
		await writeFile(resolve(output, `${name}.webp`), webp.stdout)
		await page.close()
	}
} finally {
	await browser.close()
}
