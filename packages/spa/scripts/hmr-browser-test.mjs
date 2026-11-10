import assert from "node:assert/strict"
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium } from "playwright"
import { build, createServer } from "vite"
import spa from "../src/vite.ts"

const packageRoot = resolve(import.meta.dirname, `..`)
const directory = await mkdtemp(resolve(packageRoot, `__tests__/.hmr-browser-`))
await cp(resolve(packageRoot, `__tests__/hmr`), directory, { recursive: true })
const appFile = resolve(directory, `App.tsx`),
	sceneFile = resolve(directory, `Scene.tsx`),
	stateFile = resolve(directory, `state.ts`)
const app = await readFile(appFile, `utf8`),
	scene = await readFile(sceneFile, `utf8`),
	state = await readFile(stateFile, `utf8`)
// Separate completed HMR scenarios beyond the file watcher's write coalescing window.
const edit = async (file, code) => {
	await new Promise((ready) => setTimeout(ready, 100))
	await writeFile(file, code)
}
let server, browser
try {
	server = await createServer({
		root: directory,
		configFile: false,
		logLevel: `error`,
		plugins: [spa()],
		server: { host: `127.0.0.1`, port: 0 },
	})
	await server.listen()
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		args: [`--enable-unsafe-swiftshader`],
	})
	const page = await browser.newPage()
	page.setDefaultTimeout(15000)
	const errors = []
	page.on(`pageerror`, (error) => {
		errors.push(error.message)
	})
	page.on(`console`, (message) => {
		if (message.type() === `error`) console.error(message.text())
	})
	await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
	await page.waitForFunction(() => Boolean(window.hmrTest))
	await page.locator(`[data-hmr="first"]`).click()
	await page.locator(`[data-hmr="first"]`).click()
	await page.locator(`[data-hmr="second"]`).click()
	const before = await page.evaluate(() => {
		window.hmrSentinel = 1
		return window.hmrTest.stats()
	})
	assert.equal(before.first, 2)
	assert.equal(before.second, 11)
	const ids = await page
		.locator(`[data-hmr]`)
		.evaluateAll((nodes) => nodes.map((node) => node.id))
	const version2 = app
		.replace(`view-v1`, `view-v2`)
		.replace(`value + 1`, `value + 2`)
	await edit(appFile, version2)
	await page.waitForFunction(() =>
		document
			.querySelector(`[data-hmr="first"]`)
			?.textContent.startsWith(`view-v2`),
	)
	let current = await page.evaluate(() => window.hmrTest.stats())
	assert.equal(await page.evaluate(() => window.hmrSentinel), 1)
	assert.equal(current.first, 2)
	assert.equal(current.second, 11)
	assert.deepEqual(current.subscribers, before.subscribers)
	assert.deepEqual(current.cleanups, { dom: 2, scene: 2 })
	assert.deepEqual(
		await page
			.locator(`[data-hmr]`)
			.evaluateAll((nodes) => nodes.map((node) => node.id)),
		ids,
	)
	assert.ok(current.refs.every(([, attached]) => attached))
	await page.locator(`[data-hmr="first"]`).click()
	assert.equal((await page.evaluate(() => window.hmrTest.stats())).first, 4)
	await edit(sceneFile, scene.replace(`getCount()`, `getCount() * 2`))
	await page.waitForFunction(
		() =>
			window.hmrTest
				.stats()
				.positions.find(([name]) => name === `standalone`)[1] === 8,
	)
	current = await page.evaluate(() => window.hmrTest.stats())
	assert.deepEqual(current.positions, [
		[`first`, 8],
		[`second`, 22],
		[`standalone`, 8],
	])
	assert.deepEqual(current.cleanups, { dom: 4, scene: 5 })
	assert.deepEqual(current.subscribers, before.subscribers)
	await edit(
		appFile,
		version2.replace(
			`// HMR_EDIT_POINT`,
			`throw new Error("broken hot setup");`,
		),
	)
	await page.waitForSelector(`[data-spa-hot-error]`)
	assert.equal((await page.evaluate(() => window.hmrTest.stats())).first, 4)
	assert.equal(await page.evaluate(() => window.hmrSentinel), 1)
	await edit(appFile, version2)
	try {
		await page.waitForFunction(
			() => document.querySelectorAll(`[data-hmr]`).length === 2,
		)
	} catch (error) {
		console.error(
			await page.evaluate(() => ({
				stats: window.hmrTest?.stats(),
				errors: [...document.querySelectorAll(`[data-spa-hot-error]`)].map(
					(node) => node.textContent,
				),
				body: document.body.innerHTML.slice(0, 2500),
			})),
		)
		throw error
	}
	current = await page.evaluate(() => window.hmrTest.stats())
	assert.deepEqual(current.subscribers, before.subscribers)
	assert.equal(current.first, 4)
	await edit(appFile, `export default function View() { return <`)
	await page.waitForSelector(`vite-error-overlay`)
	assert.equal(await page.locator(`[data-hmr]`).count(), 2)
	assert.equal(await page.evaluate(() => window.hmrSentinel), 1)
	await edit(appFile, version2.replace(`view-v2`, `view-v3`))
	await page.waitForFunction(() =>
		document.querySelector(`[data-hmr]`)?.textContent.startsWith(`view-v3`),
	)
	assert.equal((await page.evaluate(() => window.hmrTest.stats())).first, 4)
	const reordered = version2
		.replace(`view-v2`, `view-v4`)
		.replace(
			`export { App }\nexport default App`,
			`export default App\nexport { App }`,
		)
	await edit(appFile, reordered)
	await page.waitForFunction(() =>
		document.querySelector(`[data-hmr]`)?.textContent.startsWith(`view-v4`),
	)
	assert.equal(await page.evaluate(() => window.hmrSentinel), 1)
	assert.equal((await page.evaluate(() => window.hmrTest.stats())).first, 4)
	await edit(appFile, reordered.replace(`view-v4`, `view-v5`))
	await page.waitForFunction(() =>
		document.querySelector(`[data-hmr]`)?.textContent.startsWith(`view-v5`),
	)
	assert.equal(await page.evaluate(() => window.hmrSentinel), 1)
	assert.deepEqual(
		(await page.evaluate(() => window.hmrTest.stats())).subscribers,
		before.subscribers,
	)
	await edit(appFile, `${version2}\nexport const helper = 1\n`)
	await page.waitForFunction(
		() => window.hmrSentinel === undefined && Boolean(window.hmrTest),
	)
	assert.equal((await page.evaluate(() => window.hmrTest.stats())).first, 0)
	await page.evaluate(() => {
		window.hmrSentinel = 2
	})
	await edit(stateFile, state.replace(`default: 0`, `default: 7`))
	await page.waitForFunction(
		() =>
			window.hmrSentinel === undefined && window.hmrTest?.stats().first === 7,
	)
	await page.evaluate(() => window.hmrTest.dispose())
	const disposed = await page.evaluate(() => window.hmrTest.stats())
	assert.deepEqual(disposed.subscribers, disposed.persistentSubscribers)
	assert.deepEqual(errors, [])
	await server.close()
	server = undefined
	// createServer sets NODE_ENV; switch it before resolving production conditions.
	process.env.NODE_ENV = `production`
	await build({
		root: directory,
		configFile: false,
		logLevel: `error`,
		plugins: [spa()],
		build: { outDir: resolve(directory, `production`), minify: false },
	})
	const assets = resolve(directory, `production/assets`)
	const scripts = await Promise.all(
		(await readdir(assets))
			.filter((name) => name.endsWith(`.js`))
			.map((name) => readFile(resolve(assets, name), `utf8`)),
	)
	assert.equal(
		scripts
			.join(`\n`)
			.match(/__spaHot|spa-hot|SPA hot refresh failed|registerComponent/)?.[0],
		undefined,
		`Production bundles must omit hot registration and refresh code`,
	)
	console.log(
		`Component and scene HMR, isolated stores, history, cleanup/subscribers, failed-edit recovery, reload fallbacks, and production code elimination passed.`,
	)
} finally {
	await browser?.close()
	await server?.close()
	await rm(directory, { recursive: true, force: true })
}
