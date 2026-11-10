import assert from "node:assert/strict"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { dev } from "astro"
import { chromium } from "playwright"

const packageRoot = resolve(import.meta.dirname, `..`)
const directory = await mkdtemp(resolve(packageRoot, `__tests__/.hmr-astro-`))
await cp(resolve(packageRoot, `__tests__/hmr-astro`), directory, {
	recursive: true,
})
const componentFile = resolve(directory, `src/View.tsx`),
	stateFile = resolve(directory, `src/state.ts`)
const component = await readFile(componentFile, `utf8`),
	state = await readFile(stateFile, `utf8`)
const edit = async (file, code) => {
	await new Promise((ready) => setTimeout(ready, 100))
	await writeFile(file, code)
}
let server, browser
try {
	server = await dev({
		root: directory,
		logLevel: `error`,
		server: { host: `127.0.0.1`, port: 0 },
	})
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		args: [`--enable-unsafe-swiftshader`],
	})
	const page = await browser.newPage()
	const errors = []
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
	})
	await page.goto(`http://127.0.0.1:${server.address.port}`)
	await page.waitForFunction(
		() =>
			document.querySelectorAll(`astro-island:not([ssr]) button`).length === 3,
	)
	const buttons = page.locator(`astro-island button`)
	await buttons.first().click()
	await buttons.first().click()
	assert.deepEqual(await buttons.allTextContents(), [
		`astro-v1:4`,
		`astro-v1:10`,
		`astro-v1:20`,
	])
	const ids = await buttons.evaluateAll((nodes) => nodes.map((node) => node.id))
	await page.evaluate(() => {
		window.astroHotSentinel = true
	})
	await edit(
		componentFile,
		component.replace(`astro-v1`, `astro-v2`).replace(`value + 1`, `value + 2`),
	)
	await page.waitForFunction(() => {
		const nodes = [...document.querySelectorAll(`astro-island button`)]
		return (
			nodes.length === 3 &&
			nodes.every((node) => node.textContent.startsWith(`astro-v2`))
		)
	})
	assert.equal(await page.evaluate(() => window.astroHotSentinel), true)
	assert.deepEqual(await buttons.allTextContents(), [
		`astro-v2:4`,
		`astro-v2:10`,
		`astro-v2:20`,
	])
	assert.deepEqual(
		await buttons.evaluateAll((nodes) => nodes.map((node) => node.id)),
		ids,
	)
	assert.equal(await page.evaluate(() => window.spaIslandCleanups), 3)
	await buttons.first().click()
	assert.deepEqual(await buttons.allTextContents(), [
		`astro-v2:6`,
		`astro-v2:10`,
		`astro-v2:20`,
	])
	await edit(
		componentFile,
		component.replace(`astro-v1`, `astro-v3`).replace(`value + 1`, `value + 3`),
	)
	await page.waitForFunction(() => {
		const nodes = [...document.querySelectorAll(`astro-island button`)]
		return (
			nodes.length === 3 &&
			nodes.every((node) => node.textContent.startsWith(`astro-v3`))
		)
	})
	assert.equal(await page.evaluate(() => window.astroHotSentinel), true)
	assert.deepEqual(await buttons.allTextContents(), [
		`astro-v3:6`,
		`astro-v3:10`,
		`astro-v3:20`,
	])
	assert.deepEqual(
		await buttons.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute(`data-initial`)),
		),
		[`2`, `10`, `20`],
	)
	assert.equal(await page.locator(`[data-hmr-slot]`).textContent(), `first slot`)
	assert.deepEqual(
		await buttons.evaluateAll((nodes) => nodes.map((node) => node.id)),
		ids,
	)
	assert.equal(await page.evaluate(() => window.spaIslandCleanups), 6)
	await buttons.first().click()
	assert.equal(await buttons.first().textContent(), `astro-v3:9`)
	await page.evaluate(() => {
		for (const island of document.querySelectorAll(`astro-island`))
			island.dispatchEvent(new Event(`astro:unmount`))
	})
	assert.equal(await buttons.count(), 0)
	assert.equal(await page.locator(`[data-hmr-slot]`).count(), 0)
	assert.equal(await page.evaluate(() => window.spaIslandCleanups), 9)
	await edit(stateFile, state.replace(`default: 0`, `default: 1`))
	await page.waitForFunction(
		() =>
			window.astroHotSentinel === undefined &&
			document.querySelectorAll(`astro-island:not([ssr]) button`).length === 3,
	)
	assert.deepEqual(await buttons.allTextContents(), [
		`astro-v3:2`,
		`astro-v3:10`,
		`astro-v3:20`,
	])
	assert.deepEqual(errors, [])
	console.log(
		`Astro hydrated/client-only islands retain isolated stores and IDs across component HMR; state definitions reload.`,
	)
} finally {
	await browser?.close()
	await server?.stop()
	await rm(directory, { recursive: true, force: true })
}
