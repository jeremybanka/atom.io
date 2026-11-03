import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { build } from "esbuild"
import { chromium } from "playwright"
import { compile } from "../src/compiler.ts"

const bundle = await build({
	entryPoints: [resolve(import.meta.dirname, `../__tests__/graphics.spa.tsx`)],
	tsconfigRaw: {},
	bundle: true,
	write: false,
	format: `esm`,
	platform: `browser`,
	define: { "import.meta.env.DEV": `false` },
	plugins: [
		{
			name: `spa`,
			setup(builder) {
				builder.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
					contents: compile(await readFile(path, `utf8`), path).code,
					loader: `ts`,
				}))
			},
		},
	],
})
const server = createServer((req, res) => {
	if (req.url === `/app.js`) {
		res.setHeader(`content-type`, `application/javascript`)
		res.end(bundle.outputFiles[0].text)
	} else {
		res.setHeader(`content-type`, `text/html`)
		res.end(`<script type="module" src="/app.js"></script>`)
	}
})
await new Promise((ready) => server.listen(0, `127.0.0.1`, ready))
let browser
try {
	browser = await chromium.launch({
		headless: true,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		args: [`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`],
	})
	const page = await browser.newPage()
	const errors = []
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
		console.error(error.stack)
	})
	await page.goto(`http://127.0.0.1:${server.address().port}`)
	await page.waitForFunction(() => window.graphics?.inspect().frames > 1)
	assert.equal(
		await page.evaluate(() => window.graphics.inspect().rectWidth),
		50,
	)
	await page.evaluate(() => window.graphics.update())
	const state = await page.evaluate(() => window.graphics.inspect())
	await page.waitForFunction(
		() =>
			Math.abs(window.graphics.inspect().x - 1) < 0.001 &&
			Math.abs(window.graphics.inspect().rectX - 20) < 0.001,
	)
	const panel = page.locator(`#motion-panel`)
	await page.waitForFunction(
		() =>
			Math.abs(
				new DOMMatrix(
					getComputedStyle(document.querySelector(`#motion-panel`)).transform,
				).m41 - 200,
			) < 0.1,
	)
	await panel.hover()
	await page.waitForFunction(
		() =>
			new DOMMatrix(
				getComputedStyle(document.querySelector(`#motion-panel`)).transform,
			).m11 > 1.09,
	)
	await page.mouse.down()
	await page.waitForFunction(
		() =>
			new DOMMatrix(
				getComputedStyle(document.querySelector(`#motion-panel`)).transform,
			).m11 < 0.91,
	)
	await page.mouse.up()
	await page.waitForFunction(
		() =>
			new DOMMatrix(
				getComputedStyle(document.querySelector(`#motion-panel`)).transform,
			).m11 > 1.09,
	)
	await page.mouse.move(0, 0)
	await page.waitForFunction(
		() =>
			Math.abs(
				new DOMMatrix(
					getComputedStyle(document.querySelector(`#motion-panel`)).transform,
				).m11 - 1,
			) < 0.001,
	)
	assert.ok(state.canvases.length >= 2)
	assert.ok(state.canvases.every((width) => width === 200))
	await page.evaluate(() => window.graphics.dispose())
	assert.equal(await page.locator(`canvas`).count(), 0)
	const frames = await page.evaluate(() => window.graphics.inspect().frames)
	await page.waitForTimeout(100)
	assert.equal(
		await page.evaluate(() => window.graphics.inspect().frames),
		frames,
	)
	assert.deepEqual(errors, [])
	console.log(
		`Motion springs, DOM gestures, Konva/Three.js reactive updates, shared frame loop, and disposal passed.`,
	)
} finally {
	await browser?.close()
	await new Promise((closed) => server.close(closed))
}
