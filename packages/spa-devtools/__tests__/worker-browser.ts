import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { basename, resolve } from "node:path"

import { build } from "esbuild"
import type { Browser } from "playwright"

import { launchBrowser, loadDevtoolsAssets } from "./browser-runtime.ts"

const demo = resolve(import.meta.dirname, `../exhibits/worker`)
const bundle = await build({
	entryPoints: [resolve(demo, `main.ts`), resolve(demo, `worker.ts`)],
	outdir: `dist/worker-demo`,
	tsconfigRaw: {},
	bundle: true,
	write: false,
	format: `esm`,
	platform: `browser`,
	define: { "import.meta.env.DEV": `false` },
})
const assets = await loadDevtoolsAssets()
for (const file of bundle.outputFiles)
	assets.set(`/` + basename(file.path), {
		type: `application/javascript`,
		body: Buffer.from(file.contents),
	})
const server = createServer((req, res) => {
	const pathname = new URL(req.url ?? `/`, `http://localhost`).pathname
	const asset = assets.get(pathname)
	if (asset) {
		res.setHeader(`content-type`, asset.type)
		res.end(asset.body)
	} else if (pathname === `/`) {
		res.setHeader(`content-type`, `text/html; charset=utf-8`)
		res.end(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worker store · SPA devtools</title>
<link rel="stylesheet" href="/devtools.css">
<style>
	html { color-scheme: light dark; font: 16px system-ui; }
	body { margin: 2rem; }
	button { font: inherit; }
	output { display: block; margin: 1rem 0; font-variant-numeric: tabular-nums; }
</style>
<h1>Worker store</h1>
<button id="increment">Increment in worker</button>
<output id="worker-values">Waiting for the worker…</output>
<p>Edit <strong>count</strong> in the Atoms tab and press Enter to send it back to the worker.</p>
<div id="devtools"></div>
<script type="module" src="/main.js"></script>
</html>`)
	} else {
		res.writeHead(404).end()
	}
})
await new Promise<void>((ready) => server.listen(0, `127.0.0.1`, ready))
const url = `http://127.0.0.1:` + (server.address() as AddressInfo).port
if (process.argv.includes(`--serve`)) {
	process.stdout.write(url + `\n`)
} else {
	let browser: Browser | undefined
	try {
		browser = await launchBrowser()
		const page = await browser.newPage({
			viewport: { width: 1200, height: 850 },
			reducedMotion: `reduce`,
		})
		const errors: string[] = []
		page.on(`pageerror`, (error) => errors.push(error.message))
		await page.goto(url)
		const panel = page.getByTestId(`atom-io-devtools`)
		const count = panel.getByRole(`textbox`, { name: `count`, exact: true })
		const doubled = panel.getByRole(`textbox`, { name: `doubled`, exact: true })
		const atoms = panel.getByRole(`tab`, { name: `atoms` })
		const selectors = panel.getByRole(`tab`, { name: `selectors` })
		const increment = page.getByRole(`button`, { name: `Increment in worker` })
		const alert = panel.getByRole(`alert`)
		const expectValue = async (label: string, expected: string) => {
			await page.waitForFunction(
				({ key, value }) =>
					document.querySelector<HTMLInputElement>(
						`debugger-panel input[aria-label="` + key + `"]`,
					)?.value === value,
				{ key: label, value: expected },
			)
		}
		const expectWorker = async (value: number, derived: number) => {
			await page
				.getByText(`Count: ` + value + ` · Doubled: ` + derived, { exact: true })
				.waitFor()
		}

		await expectValue(`count`, `2`)
		await increment.click()
		await expectValue(`count`, `3`)
		await selectors.click()
		await expectValue(`doubled`, `6`)
		assert.equal(await doubled.getAttribute(`readonly`), ``)
		await increment.click()
		await expectValue(`doubled`, `8`)

		await atoms.click()
		await count.fill(`17`)
		await expectWorker(4, 8)
		await count.press(`Enter`)
		await expectWorker(17, 34)
		await expectValue(`count`, `17`)
		await selectors.click()
		await expectValue(`doubled`, `34`)

		await atoms.click()
		await count.fill(`1.5`)
		await count.press(`Enter`)
		await alert.filter({ hasText: `Worker rejected this value` }).waitFor()
		await expectValue(`count`, `17`)

		await count.fill(`20`)
		// Send a worker update while the input still holds an unsubmitted draft.
		await increment.evaluate((button: HTMLButtonElement) => {
			button.click()
		})
		await expectWorker(18, 36)
		assert.equal(await count.inputValue(), `20`)
		await count.press(`Enter`)
		await alert
			.filter({ hasText: `Worker state changed while you were editing` })
			.waitFor()
		await expectValue(`count`, `18`)
		await count.fill(`25`)
		await count.press(`Enter`)
		await expectWorker(25, 50)
		await selectors.click()
		await expectValue(`doubled`, `50`)
		await alert.waitFor({ state: `hidden` })
		assert.deepEqual(errors, [])
		const screenshot = process.env[`SPA_DEVTOOLS_WORKER_SCREENSHOT`]
		if (screenshot) await page.screenshot({ path: screenshot })
		process.stdout.write(`Worker devtools round trip passed\n`)
	} finally {
		await browser?.close()
		server.close()
	}
}
