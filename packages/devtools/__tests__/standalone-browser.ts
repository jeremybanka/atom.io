import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:http"
import { createInterface } from "node:readline"
import { setTimeout } from "node:timers/promises"
import { fileURLToPath } from "node:url"

import { attachDevtoolsWebSocket } from "@atom.io/devtools/standalone"
import { Silo } from "atom.io"

import { launchBrowser } from "./browser-runtime.ts"

const silo = new Silo({
	name: `Production test`,
	lifespan: `ephemeral`,
	isProduction: true,
})
const server = createServer()
const token = `browser-control-test-token`
const detach = attachDevtoolsWebSocket(server, silo, {
	token,
	productionAccess: `control`,
})
const counterAtom = silo.atom<number>({ key: `counter`, default: 4 })
assert.equal(silo.getState(counterAtom), 4)
server.listen(0, `127.0.0.1`)
await once(server, `listening`)
try {
	const address = server.address()
	assert.ok(address && typeof address !== `string`)
	const cli = spawn(
		process.execPath,
		[
			fileURLToPath(new URL(`../dist/cli.js`, import.meta.url)),
			`http://127.0.0.1:` + address.port,
		],
		{
			env: { ...process.env, ATOM_IO_DEVTOOLS_TOKEN: token },
			stdio: [`ignore`, `pipe`, `inherit`],
		},
	)
	const exited = once(cli, `exit`)
	const output = createInterface({ input: cli.stdout })
	try {
		const { value: url, done } = await output[Symbol.asyncIterator]().next()
		assert.equal(done, false, `Expected the CLI to print a local viewer URL`)
		assert.equal(new URL(url).hostname, `127.0.0.1`)
		assert.doesNotMatch(url, new RegExp(token))
		const browser = await launchBrowser()
		try {
			const page = await browser.newPage({
				viewport: { width: 900, height: 600 },
			})
			await page.goto(url)
			const panel = page.getByTestId(`atom-io-devtools`)
			const count = panel.getByRole(`textbox`, {
				name: counterAtom.key,
				exact: true,
			})
			await count.waitFor()
			assert.equal(await count.inputValue(), `4`)
			assert.equal(await count.getAttribute(`readonly`), null)
			assert.deepEqual(await panel.boundingBox(), {
				x: 0,
				y: 0,
				width: 900,
				height: 600,
			})
			assert.equal(
				await panel.locator(`debugger-toolbar > button, [data-resize]`).count(),
				0,
			)

			silo.setState(counterAtom, 5)
			await page.waitForFunction(
				(key) =>
					document.querySelector<HTMLInputElement>(
						`input[aria-label="` + key + `"]`,
					)?.value === `5`,
				counterAtom.key,
			)
			const { promise, resolve } = Promise.withResolvers<void>()
			const unsubscribe = silo.subscribe(counterAtom, () => {
				resolve()
			})
			try {
				await count.fill(`9`)
				await count.press(`Enter`)
				await Promise.race([
					promise,
					setTimeout(5_000, undefined, { ref: false }).then(() =>
						assert.fail(`The browser edit did not reach the target Silo`),
					),
				])
				assert.equal(silo.getState(counterAtom), 9)
			} finally {
				unsubscribe()
			}
		} finally {
			await browser.close()
		}
	} finally {
		output.close()
		cli.kill()
		await exited
	}
} finally {
	detach()
	await new Promise<void>((closed) => {
		server.close(() => {
			closed()
		})
	})
}
