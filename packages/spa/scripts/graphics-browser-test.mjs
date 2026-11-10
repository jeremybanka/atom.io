import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { build } from "esbuild"
import { chromium } from "playwright"
import { compile } from "../src/compiler.ts"

const bundle = await build({
	entryPoints: [resolve(import.meta.dirname, `../__tests__/graphics.tsx`)],
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
	await page.waitForFunction(() => {
		const panel = document.querySelector(`#motion-panel`)
		const x = new DOMMatrix(getComputedStyle(panel).transform).m41
		return x > 0 && x < 100 && getComputedStyle(panel).width === `100px`
	})
	await page.screenshot({ path: `/tmp/spa-keyframe-banner.png` })
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
	const canvas = page.locator(`canvas`).last()
	const bounds = await canvas.boundingBox()
	const point = await page.evaluate(() => window.graphics.point())
	await page.mouse.move(
		bounds.x + bounds.width * point.x,
		bounds.y + bounds.height * point.y,
	)
	await page.waitForFunction(
		() => Math.abs(window.graphics.inspect().scale - 1.2) < 0.001,
	)
	await page.mouse.down()
	await page.waitForFunction(
		() => Math.abs(window.graphics.inspect().scale - 0.8) < 0.001,
	)
	await page.mouse.move(
		bounds.x + bounds.width + 50,
		bounds.y + bounds.height + 50,
	)
	await page.mouse.up()
	await page.waitForFunction(
		() => Math.abs(window.graphics.inspect().scale - 1) < 0.001,
	)
	const input = await page.evaluate(() => window.graphics.inspect())
	assert.equal(input.downs, 1)
	assert.equal(input.ups, 1)
	assert.ok(input.moves >= 1)
	await page.evaluate(() => window.graphics.dispose())
	assert.equal(await page.locator(`canvas`).count(), 0)
	const frames = await page.evaluate(() => window.graphics.inspect().frames)
	await page.waitForTimeout(100)
	assert.equal(
		await page.evaluate(() => window.graphics.inspect().frames),
		frames,
	)
	await page.evaluate(() => window.presence.start())
	await page.waitForFunction(() => window.presence.inspect().draws > 2)
	const button = page.locator(`#presence-button`)
	await button.focus()
	await button.click()
	assert.equal(await page.evaluate(() => window.presence.inspect().clicks), 1)
	await page.evaluate(() => window.presence.show(false))
	assert.equal(
		await page.locator(`#presence-panel[inert][aria-hidden=true]`).count(),
		1,
	)
	assert.equal(
		await button.evaluate((node) => document.activeElement === node),
		false,
	)
	const exiting = await page.evaluate(() => window.presence.inspect())
	assert.equal(exiting.stageListening, false)
	assert.equal(exiting.rectListening, false)
	assert.equal(exiting.disposed, 0)
	await button.evaluate((node) => node.click())
	await page.waitForFunction(
		(before) => window.presence.inspect().draws > before + 2,
		exiting.draws,
	)
	assert.equal(
		await page.evaluate(() => window.presence.inspect().userFrames),
		exiting.userFrames,
	)
	assert.equal(await page.evaluate(() => window.presence.inspect().clicks), 1)
	await page.evaluate(() => window.presence.show(true))
	const revived = await page.evaluate(() => window.presence.inspect())
	assert.ok(revived.samePanel && revived.sameMesh && revived.sameRect)
	assert.equal(revived.stageListening, true)
	assert.equal(revived.rectListening, true)
	assert.equal(await page.locator(`#presence-panel[inert]`).count(), 0)
	await button.click()
	assert.equal(await page.evaluate(() => window.presence.inspect().clicks), 2)
	await page.evaluate(() => window.presence.show(false))
	await page.waitForFunction(() => !document.querySelector(`#presence-panel`))
	assert.equal(await page.evaluate(() => window.presence.inspect().disposed), 1)
	await page.evaluate(() => window.presence.dispose())
	assert.equal(await page.locator(`canvas`).count(), 0)

	for (const mode of [`rect`, `group`, `stage`]) {
		for (const active of [false, true]) {
			await page.evaluate((kind) => {
				window.drag = window.konvaDrag(kind)
			}, mode)
			const surface = page.locator(`.konvajs-content`)
			const box = await surface.boundingBox()
			const startX = mode === `stage` ? 100 : 10
			await page.mouse.move(box.x + startX, box.y + 10)
			await page.mouse.down()
			if (active) await page.mouse.move(box.x + startX + 20, box.y + 10)
			const before = await page.evaluate(() => window.drag.inspect())
			assert.equal(
				mode === `stage` ? before.stageDragging : before.dragging,
				active,
			)
			await page.evaluate(() => window.drag.show(false))
			const exitingDrag = await page.evaluate(() => window.drag.inspect())
			assert.equal(exitingDrag.dragging, false)
			assert.equal(exitingDrag.draggable, false)
			if (mode === `stage`) {
				assert.equal(exitingDrag.stageDragging, false)
				assert.equal(exitingDrag.stageDraggable, false)
			}
			await page.mouse.move(box.x + 60, box.y + 10)
			assert.equal(
				(await page.evaluate(() => window.drag.inspect())).x,
				exitingDrag.x,
			)
			await page.evaluate(() => window.drag.show(true))
			const returned = await page.evaluate(() => window.drag.inspect())
			assert.ok(returned.sameRect)
			assert.equal(returned.draggable, true)
			if (mode === `stage`) assert.equal(returned.stageDraggable, true)
			await page.mouse.move(box.x + 80, box.y + 10)
			const continued = await page.evaluate(() => window.drag.inspect())
			assert.equal(continued.x, returned.x)
			assert.equal(continued.stageX, returned.stageX)
			assert.equal(continued.moves, before.moves)
			assert.equal(continued.ends, 0)
			await page.mouse.up()
			// A new press starts a new drag normally after revival.
			await page.mouse.move(
				box.x + returned.stageX + returned.x + 10,
				box.y + 10,
			)
			await page.mouse.down()
			await page.mouse.move(
				box.x + returned.stageX + returned.x + 30,
				box.y + 10,
			)
			assert.equal(
				(await page.evaluate(() => window.drag.inspect())).dragging,
				true,
			)
			await page.mouse.up()
			await page.evaluate(() => window.drag.dispose())
		}
	}
	// Programmatic drags can exist even with draggable=false.
	await page.evaluate(() => {
		window.drag = window.konvaDrag(`rect`, false)
		window.drag.startRect()
		window.drag.show(false)
	})
	assert.equal(
		(await page.evaluate(() => window.drag.inspect())).dragging,
		false,
	)
	await page.evaluate(() => {
		window.drag.show(true)
	})
	assert.equal(
		(await page.evaluate(() => window.drag.inspect())).draggable,
		false,
	)
	await page.evaluate(() => window.drag.dispose())

	assert.deepEqual(errors, [])
	console.log(
		`Motion springs, DOM gestures, Konva/Three.js reactive updates, shared frame loop, exit retention/re-entry, and disposal passed.`,
	)
} finally {
	await browser?.close()
	await new Promise((closed) => server.close(closed))
}
