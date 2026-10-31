#!/usr/bin/env node
import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { dev } from "astro"
import { chromium } from "playwright"

// Capture the actual WebGL shaders, not a separate approximation. The fixed
// geometry seed, reduced motion (t = 0), blue palette, and 1× density define
// the static mark. Small sizes use the same supporting cloud as the previews.
const root = resolve(import.meta.dirname, `..`)
const output = join(root, `public/spa`)
const temporary = await mkdtemp(join(tmpdir(), `spa-icons-`))
const assets = [
	[1024, `logo.png`],
	[512, `icon-512.png`],
	[48, `icon-48.png`],
	[32, `icon-32.png`],
	[16, `icon-16.png`],
]
let server, browser
try {
	server = await dev({
		root,
		server: { host: `127.0.0.1`, port: 0 },
		vite: { cacheDir: join(temporary, `vite`) },
		logLevel: `error`,
	})
	browser = await chromium.launch({
		args: [`--enable-unsafe-swiftshader`, `--disable-dev-shm-usage`],
	})
	const page = await browser.newPage({
		viewport: { width: 1440, height: 1100 },
		deviceScaleFactor: 1,
		reducedMotion: `reduce`,
	})
	const errors = []
	page.on(`pageerror`, (error) => errors.push(error.message))
	page.on(`console`, (message) => {
		if (message.type() === `error`) errors.push(message.text())
	})
	await page.goto(`http://127.0.0.1:${server.address.port}/spa-lab`)
	await page.waitForSelector(`spa-lab[data-ready="true"]`)
	assert.equal(await page.locator(`#motion`).textContent(), `Resume motion`)
	for (const [size, name] of assets) {
		await page.locator(`#export-size`).selectOption(String(size))
		const downloading = page.waitForEvent(`download`)
		await page.locator(`[data-export="negative"]`).click()
		const download = await downloading
		const destination = join(temporary, name)
		await download.saveAs(destination)
		const data = await readFile(destination)
		assert.equal(data.readUInt32BE(16), size)
		assert.equal(data.readUInt32BE(20), size)
		const alpha = await page.evaluate(
			async (png) => {
				const image = new Image()
				image.src = png
				await image.decode()
				const canvas = document.createElement(`canvas`)
				canvas.width = canvas.height = image.width
				const context = canvas.getContext(`2d`)
				context.drawImage(image, 0, 0)
				const pixels = context.getImageData(0, 0, image.width, image.height).data
				let ink = 0,
					centerInk = 0
				for (let y = 0; y < image.height; y++) {
					for (let x = 0; x < image.width; x++) {
						if (pixels[(y * image.width + x) * 4 + 3] === 0) continue
						ink++
						if (
							Math.hypot(x + 0.5 - image.width / 2, y + 0.5 - image.height / 2) <
							image.width * 0.08
						)
							centerInk++
					}
				}
				return { ink, centerInk, corner: pixels[3] }
			},
			`data:image/png;base64,${data.toString(`base64`)}`,
		)
		assert(alpha.ink > 0, `${name} must contain visible cloud`)
		assert.equal(alpha.centerInk, 0, `${name} must have a clear center`)
		assert.equal(alpha.corner, 0, `${name} must have a transparent background`)
	}
	assert.deepEqual(errors, [])
	await mkdir(output, { recursive: true })
	for (const [, name] of assets) {
		await writeFile(join(output, name), await readFile(join(temporary, name)))
	}
	console.log(`Captured SPA logo and 16/32/48/512px icons in ${output}`)
} finally {
	await browser?.close()
	await server?.stop()
	await rm(temporary, { recursive: true, force: true })
}
