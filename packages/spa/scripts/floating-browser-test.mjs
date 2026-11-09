import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { chromium } from "playwright"
import { createServer } from "vite"

const cacheDir = await mkdtemp(join(tmpdir(), `spa-floating-`))
let server, browser
try {
	server = await createServer({
		configFile: resolve(
			import.meta.dirname,
			`../examples/floating/vite.config.ts`,
		),
		server: { host: `127.0.0.1`, port: 0 },
		cacheDir,
		logLevel: `error`,
	})
	await server.listen()
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
	})
	for (const query of [``, `?motion-first`]) {
		const page = await browser.newPage({
			viewport: { width: 1000, height: 800 },
		})
		const errors = []
		page.on(`pageerror`, (error) => errors.push(error.message))
		await page.goto(
			`http://127.0.0.1:${server.httpServer.address().port}/${query}`,
		)
		await page.waitForFunction(() => {
			const panel = document.querySelector(`#overlay`)
			return panel?.style.translate && Number(panel.style.opacity) === 1
		})
		const original = await page.locator(`#overlay`).elementHandle()
		const measure = () =>
			page.evaluate(() => {
				const node = document.querySelector(`#overlay`)
				const style = getComputedStyle(node)
				const [x, y] = style.translate.split(` `).map(parseFloat)
				const matrix = new DOMMatrixReadOnly(style.transform)
				const rect = node.getBoundingClientRect()
				const anchor = document.querySelector(`#anchor`).getBoundingClientRect()
				const points = [
					[0, 0],
					[node.offsetWidth, 0],
					[0, node.offsetHeight],
					[node.offsetWidth, node.offsetHeight],
				].map(([pointX, pointY]) =>
					matrix.transformPoint({ x: pointX, y: pointY }),
				)
				return {
					x,
					y,
					scale: Math.hypot(matrix.a, matrix.b),
					rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
					xError:
						rect.x -
						(x +
							Math.min(...points.map((point) => point.x)) -
							(style.position === `absolute` ? scrollX : 0)),
					yError:
						rect.y -
						(y +
							Math.min(...points.map((point) => point.y)) -
							(style.position === `absolute` ? scrollY : 0)),
					anchorX: anchor.left,
					anchorY: anchor.bottom + 12,
					position: style.position,
				}
			})
		const assertComposed = (sample) => {
			assert.ok(Math.abs(sample.xError) < 0.1, JSON.stringify(sample))
			assert.ok(Math.abs(sample.yError) < 0.1, JSON.stringify(sample))
		}
		const waitAnchored = async () => {
			await page.waitForFunction(() => {
				const node = document.querySelector(`#overlay`)
				const style = getComputedStyle(node)
				const [x, y] = style.translate.split(` `).map(parseFloat)
				const anchor = document.querySelector(`#anchor`).getBoundingClientRect()
				return (
					Math.abs(
						x - anchor.left - (style.position === `absolute` ? scrollX : 0),
					) < 0.5 &&
					Math.abs(
						y -
							anchor.bottom -
							12 -
							(style.position === `absolute` ? scrollY : 0),
					) < 0.5
				)
			})
		}
		await waitAnchored()
		const initial = await measure()
		assertComposed(initial)
		assert.ok(Math.abs(initial.scale - 0.8) < 0.001)
		assert.ok(Math.abs(initial.rotation + 8) < 0.001)
		// Floating's measurement must use the layout size, even while Motion scales it.
		await page.locator(`#transform`).click()
		const samples = []
		for (let frame = 0; frame < 10; ++frame) {
			await page.evaluate(() => new Promise(requestAnimationFrame))
			const sample = await measure()
			assertComposed(sample)
			assert.ok(Math.abs(sample.y - initial.y) < 0.5)
			samples.push(sample)
		}
		assert.ok(new Set(samples.map((sample) => sample.scale.toFixed(3))).size > 2)
		// The reference also moves with Motion; animationFrame updates follow its transform.
		await page.locator(`#move`).click()
		await page.waitForFunction(() =>
			document.querySelector(`#anchor`).style.transform.includes(`120px`),
		)
		await waitAnchored()
		assertComposed(await measure())
		await page.locator(`.scroller`).evaluate((node) => {
			node.scrollTop = 40
			node.scrollLeft = 50
		})
		await waitAnchored()
		assertComposed(await measure())
		// Switching positioning strategies preserves the same visual anchor after page scrolling.
		await page.locator(`#strategy`).click()
		await page.evaluate(() => {
			scrollTo(0, 80)
		})
		await waitAnchored()
		const absolute = await measure()
		assert.equal(absolute.position, `absolute`)
		assertComposed(absolute)
		await page.evaluate(() => {
			scrollTo(0, 0)
		})
		await page.locator(`#strategy`).click()
		await waitAnchored()
		// Flip and shift use the unscaled dimensions at a viewport edge.
		await page.locator(`#alternate`).click()
		await page.waitForFunction(() => {
			const node = document.querySelector(`#overlay`)
			const [x, y] = node.style.translate.split(` `).map(parseFloat)
			const anchor = document.querySelector(`#corner`).getBoundingClientRect()
			return (
				Math.abs(y - (anchor.top - 12 - node.offsetHeight)) < 0.5 &&
				x + node.offsetWidth <= innerWidth - 11
			)
		})
		await page.setViewportSize({ width: 720, height: 740 })
		await page.waitForFunction(() => {
			const node = document.querySelector(`#overlay`)
			const [x, y] = node.style.translate.split(` `).map(parseFloat)
			const anchor = document.querySelector(`#corner`).getBoundingClientRect()
			return (
				Math.abs(y - (anchor.top - 12 - node.offsetHeight)) < 0.5 &&
				Math.abs(x + node.offsetWidth - (innerWidth - 12)) < 0.5
			)
		})
		assertComposed(await measure())
		// Retained exits keep positioning live and re-entry keeps the exact same element.
		await page.locator(`#alternate`).click()
		await waitAnchored()
		await page.locator(`#toggle`).click()
		await page.waitForFunction(() =>
			document.querySelector(`#overlay`)?.hasAttribute(`inert`),
		)
		await page.locator(`.scroller`).evaluate((node) => {
			node.scrollTop = 60
		})
		await waitAnchored()
		assertComposed(await measure())
		await page.locator(`#toggle`).click()
		assert.equal(
			await page.evaluate(
				(node) => node === document.querySelector(`#overlay`),
				original,
			),
			true,
		)
		await page.waitForFunction(
			() => Number(document.querySelector(`#overlay`).style.opacity) === 1,
		)
		await page.locator(`#enabled`).click()
		assert.equal(
			await page.locator(`#overlay`).evaluate((node) => node.style.translate),
			``,
		)
		await page.locator(`#enabled`).click()
		await waitAnchored()
		await page.screenshot({
			path: `/tmp/spa-floating-motion${query ? `-motion-first` : ``}.png`,
		})
		await page.locator(`#toggle`).click()
		await page.waitForFunction(() => !document.querySelector(`#overlay`))
		assert.equal(await original.evaluate((node) => node.style.translate), ``)
		await page.locator(`#toggle`).click()
		await waitAnchored()
		assert.equal(
			await page.evaluate(
				(node) => node === document.querySelector(`#overlay`),
				original,
			),
			false,
		)
		const replacement = await page.locator(`#overlay`).elementHandle()
		await page.locator(`#dispose`).click()
		assert.equal(await page.locator(`#overlay`).count(), 0)
		assert.equal(await replacement.evaluate((node) => node.style.translate), ``)
		assert.deepEqual(errors, [])
		await page.close()
	}
	console.log(
		`Floating + Motion passed in both registration orders: same-element scale/rotation, transformed anchors, scroll, fixed/absolute, flip/shift, resize, retained exit/re-entry, disable, and disposal.`,
	)
} finally {
	await browser?.close()
	await server?.close()
	await rm(cacheDir, { recursive: true, force: true })
}
