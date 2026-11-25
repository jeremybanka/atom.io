import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer, get, type IncomingMessage } from "node:http"
import { createInterface } from "node:readline"
import { setTimeout } from "node:timers/promises"
import { fileURLToPath } from "node:url"

import {
	attachDevtoolsWebSocket,
	serveDevtoolsStore,
} from "@atom.io/devtools/standalone"
import { Silo } from "atom.io"
import type { Browser } from "playwright"

import { decodeStandaloneFrame } from "../src/standalone-wire.ts"
import { launchBrowser } from "./browser-runtime.ts"

const production = new Silo({
	name: `Production test`,
	lifespan: `ephemeral`,
	isProduction: true,
})
await assert.rejects(
	serveDevtoolsStore(production),
	/requires explicit inspection access/,
)

const silo = new Silo({
	name: `Standalone test`,
	lifespan: `ephemeral`,
	isProduction: false,
})
const countAtom = silo.atom<number>({ key: `count`, default: 1 })
assert.equal(silo.getState(countAtom), 1)
const viewer = await serveDevtoolsStore(silo)

async function verifyRemoteControl(browser: Browser): Promise<void> {
	const server = createServer()
	const token = `browser-control-test-token`
	const detach = attachDevtoolsWebSocket(server, production, {
		token,
		productionAccess: `control`,
	})
	const counterAtom = production.atom<number>({ key: `counter`, default: 4 })
	assert.equal(production.getState(counterAtom), 4)
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
			assert.doesNotMatch(url, new RegExp(token))
			const page = await browser.newPage()
			await page.goto(url)
			const count = page.getByRole(`textbox`, {
				name: counterAtom.key,
				exact: true,
			})
			await count.waitFor()
			assert.equal(await count.inputValue(), `4`)
			assert.equal(await count.getAttribute(`readonly`), null)
			const { promise, resolve } = Promise.withResolvers<void>()
			const unsubscribe = production.subscribe(counterAtom, () => {
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
				assert.equal(production.getState(counterAtom), 9)
			} finally {
				unsubscribe()
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
}

try {
	assert.equal(viewer.url.hostname, `127.0.0.1`)
	assert.equal((await fetch(new URL(`/events`, viewer.url))).status, 404)
	assert.equal(
		(await fetch(new URL(`events`, viewer.url), { method: `POST` })).status,
		404,
	)

	const browser = await launchBrowser()
	try {
		const page = await browser.newPage()
		await page.goto(viewer.url.href)
		const panel = page.locator(`debugger-panel:not([hidden])`)
		await page.setViewportSize({ width: 900, height: 600 })
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
		await panel.getByRole(`tab`, { name: `atoms` }).click()
		await panel.getByText(`Inspection only`).waitFor()
		const value = panel.getByRole(`textbox`, {
			name: countAtom.key,
			exact: true,
		})
		await value.waitFor()
		assert.equal(await value.inputValue(), `1`)
		assert.equal(await value.getAttribute(`readonly`), ``)
		silo.setState(countAtom, 2)
		await page.waitForFunction(
			(key) =>
				document.querySelector<HTMLInputElement>(
					`input[aria-label="` + key + `"]`,
				)?.value === `2`,
			countAtom.key,
		)
		await Promise.race([
			viewer.close(),
			setTimeout(2_000, undefined, { ref: false }).then(() =>
				assert.fail(`The viewer did not close with the browser connected`),
			),
		])
		await verifyRemoteControl(browser)
	} finally {
		await browser.close()
	}
} finally {
	await viewer.close()
}

const largeValue = `x`.repeat(16 * 1024 * 1024)
const largeAtom = silo.atom<string>({ key: `large`, default: largeValue })
const opaqueAtom = silo.atom<unknown>({
	key: `opaque`,
	default: JSON.parse(`{"nested":{"__proto__":{}}}`),
})
silo.getState(largeAtom)
silo.getState(opaqueAtom)
const cryptoKey = await crypto.subtle.generateKey(
	{ name: `HMAC`, hash: `SHA-256` },
	false,
	[`sign`],
)
const streamViewer = await serveDevtoolsStore(silo)
try {
	const request = get(new URL(`events`, streamViewer.url), {
		signal: AbortSignal.timeout(10_000),
	})
	const [response] = (await once(request, `response`)) as [IncomingMessage]
	assert.equal(response.statusCode, 200)
	// Publish a live update while the initial snapshot is still buffered.
	silo.setState(opaqueAtom, cryptoKey)
	silo.setState(countAtom, 3)
	const lines = createInterface({ input: response })
	const frames = lines[Symbol.asyncIterator]()
	async function readFrame() {
		const { value } = await frames.next()
		assert.ok(typeof value === `string`)
		assert.ok(value.startsWith(`data: `))
		assert.equal((await frames.next()).value, ``)
		return decodeStandaloneFrame(value.slice(6))
	}
	try {
		const initial = await readFrame()
		assert.equal(initial.type, `store`)
		const large = initial.snapshot.states.find(
			({ token }) => token.key === largeAtom.key,
		)?.cache
		assert.equal(large?.status, `value`)
		assert.ok(typeof large.value === `string`)
		assert.equal(large.value.length, largeValue.length)
		const initialOpaque = initial.snapshot.states.find(
			({ token }) => token.key === opaqueAtom.key,
		)?.cache
		assert.equal(initialOpaque?.status, `value`)
		assert.ok(initialOpaque.value instanceof Error)
		assert.match(initialOpaque.value.message, /could not be displayed/)

		const next = await readFrame()
		assert.equal(next.type, `store-update`)
		assert.deepEqual(
			next.update.states.find(({ token }) => token.key === countAtom.key)?.cache,
			{ status: `value`, value: 3 },
		)
		const updatedOpaque = next.update.states.find(
			({ token }) => token.key === opaqueAtom.key,
		)?.cache
		assert.equal(updatedOpaque?.status, `value`)
		assert.ok(updatedOpaque.value instanceof Error)
	} finally {
		lines.close()
	}
} finally {
	await streamViewer.close()
}
