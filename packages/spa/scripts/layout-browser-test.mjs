import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { build } from "esbuild"
import { chromium } from "playwright"
import { compile } from "../src/compiler.ts"

const bundle = await build({
	entryPoints: [resolve(import.meta.dirname, `../__tests__/layout-browser.tsx`)],
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
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		args: [`--enable-unsafe-swiftshader`],
	})
	const page = await browser.newPage()
	const errors = []
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
		console.error(error.stack)
	})
	await page.goto(`http://127.0.0.1:${server.address().port}`)
	await page.waitForTimeout(100)
	const before = await page.evaluate(() => window.layoutTest.inspect())

	await page.evaluate(() => window.layoutTest.update(1))
	await page.waitForTimeout(80)
	const during = await page.evaluate(() => window.layoutTest.inspect())

	assert.ok(
		during.marker.x > before.marker.x + 1 && during.marker.x < 240,
		`Shared marker must move through an intermediate position`,
	)
	assert.ok(
		during.panel.width > 300 && during.panel.width < 500,
		`Container width must project through intermediate sizes`,
	)
	assert.ok(
		during[`animated-layout`].width > 40 && during[`animated-layout`].width < 80,
		`Reactive Motion properties must share layout's transform renderer`,
	)
	assert.equal(during.unrelated.x, before.unrelated.x)
	assert.equal(during[`other-root`].x, before[`other-root`].x)
	assert.ok(during[`floating-layout`].translate)
	await page.screenshot({ path: `/tmp/spa-layout-intermediate.png` })
	await page.waitForTimeout(450)
	const after = await page.evaluate(() => window.layoutTest.inspect())

	assert.ok(after.marker.x > 240)
	assert.ok(Math.abs(after[`animated-layout`].y - 320) < 1)
	assert.ok(Math.abs(after.panel.width - 500) < 0.5)
	assert.ok(Math.abs(after.nested.x - before.nested.x - 120) < 1)
	assert.ok(Math.abs(after.nested.y - before.nested.y) < 1)
	await page.evaluate(() => {
		window.retainedNode = document.querySelector(`#retained`)
		window.layoutTest.show(false)
	})
	assert.equal(await page.locator(`#retained`).count(), 1)
	await page.waitForTimeout(50)
	assert.ok(
		Number(
			await page
				.locator(`#retained`)
				.evaluate((element) => getComputedStyle(element).opacity),
		) < 0.99,
		`Motion exit opacity must continue while layout owns projection`,
	)
	await page.evaluate(() => window.layoutTest.show(true))
	await page.waitForTimeout(300)
	assert.equal(
		await page.evaluate(
			() => document.querySelector(`#retained`) === window.retainedNode,
		),
		true,
	)
	await page.evaluate(() => {
		document.querySelector(`#nested-parent`).style.width = `300px`
	})
	await page.waitForTimeout(80)
	const resizing = await page.evaluate(() => window.layoutTest.inspect())
	assert.ok(
		resizing[`nested-parent`].width > 288 &&
			resizing[`nested-parent`].width < 360,
	)
	await page.waitForTimeout(400)
	assert.ok(
		Math.abs(
			(await page.evaluate(() => window.layoutTest.inspect()))[`nested-parent`]
				.width - 360,
		) < 1,
	)
	await page.evaluate(() => {
		document.body.style.height = `1400px`
		window.scrollTo(0, 90)
	})
	await page.evaluate(() => window.layoutTest.update(0))
	await page.waitForTimeout(400)
	assert.ok(
		Math.abs(
			(await page.evaluate(() => window.layoutTest.inspect())).marker.y + 82,
		) < 1,
	)
	await page.evaluate(() => window.scrollTo(0, 0))
	await page.evaluate(() => window.layoutTest.update(0))
	await page.waitForTimeout(70)
	await page.evaluate(() => window.layoutTest.update(1))
	await page.waitForTimeout(450)
	assert.ok(
		(await page.evaluate(() => window.layoutTest.inspect())).marker.x > 240,
	)
	await page.emulateMedia({ reducedMotion: `reduce` })
	await page.evaluate(() => window.layoutTest.update(0))
	await page.waitForTimeout(40)
	const reduced = await page.evaluate(() => window.layoutTest.inspect())
	assert.ok(reduced.marker.x < 20)
	assert.ok(Math.abs(reduced.panel.width - 300) < 0.5)
	await page.emulateMedia({ reducedMotion: `no-preference` })
	await page.evaluate(() => window.layoutTest.update(1))
	await page.waitForTimeout(60)
	await page.evaluate(() => window.layoutTest.dispose())
	const disposed = await page.evaluate(() => window.layoutTest.afterDispose())
	await page.waitForTimeout(450)
	assert.equal(
		await page.evaluate(() => window.layoutTest.afterDispose()),
		disposed,
	)
	assert.ok(disposed.includes(`rotate(8deg)`))
	await page.reload()
	await page.waitForTimeout(100)
	assert.ok(
		(await page.evaluate(() => window.layoutTest.fail())).includes(`finite`),
	)
	assert.equal(await page.evaluate(() => window.layoutTest.empty()), true)
	await page.waitForTimeout(400)
	assert.deepEqual(errors, [])
	console.log(
		`DOM layout projection, shared identity, nested transforms, independent Floating UI translate, interruption, reduced motion, and teardown passed.`,
	)
} finally {
	await browser?.close()
	await new Promise((done) => server.close(done))
}
