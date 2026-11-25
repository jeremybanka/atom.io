// @vitest-environment node

import { writeSync } from "node:fs"
import { resolve } from "node:path"

import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { serveRemoteViewer } from "../src/remote-viewer.ts"
import { serveDevtoolsStore } from "../src/standalone.ts"

vi.mock(`node:fs`, { spy: true })
vi.mock(`../src/remote-viewer.ts`, () => ({ serveRemoteViewer: vi.fn() }))
vi.mock(`../src/standalone.ts`, () => ({ serveDevtoolsStore: vi.fn() }))

const entry = resolve(import.meta.dirname, `../exhibits/standalone-silo.ts`)
const exit = new Error(`CLI exited`)
const url = new URL(`http://127.0.0.1:12345/viewer/`)

beforeEach(() => {
	vi.resetModules()
	vi.spyOn(process.stdout, `write`).mockReturnValue(true)
	vi.spyOn(process, `exit`).mockImplementation(() => {
		throw exit
	})
	vi.mocked(writeSync).mockReturnValue(0)
	vi.mocked(serveDevtoolsStore)
		.mockReset()
		.mockResolvedValue({
			url,
			close: vi.fn(async () => {}),
		})
	vi.mocked(serveRemoteViewer).mockResolvedValue({
		url,
		close: vi.fn(async () => {}),
	})
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
})

function launch(...args: string[]) {
	vi.stubGlobal(
		`process`,
		Object.assign(Object.create(process), {
			argv: [process.execPath, `atom-io-devtools`, ...args],
		}),
	)
	return import(`../src/cli.ts`)
}

it(`prints generated help without importing a target`, async () => {
	await launch(`-h`)
	expect(process.stdout.write).toHaveBeenCalledWith(
		expect.stringContaining(`atom-io-devtools <target>`),
	)
	expect(serveDevtoolsStore).not.toHaveBeenCalled()
	expect(process.exit).not.toHaveBeenCalled()
})

it(`uses the remote viewer for endpoint URLs`, async () => {
	vi.stubEnv(`ATOM_IO_DEVTOOLS_TOKEN`, `test-token`)
	await launch(`https://example.test`, `--port`, `8123`)
	expect(serveRemoteViewer).toHaveBeenCalledWith(
		`https://example.test`,
		`test-token`,
		8123,
	)
	expect(serveDevtoolsStore).not.toHaveBeenCalled()
	expect(process.stdout.write).toHaveBeenCalledWith(url.href + `\n`)
})

it.each([
	[[], { port: 0 }],
	[
		[`--port`, `8123`, `--allow-production`],
		{ port: 8123, productionAccess: `inspect` },
	],
] as const)(
	`starts the imported Silo with options %j`,
	async (args, options) => {
		await launch(...args, entry)
		expect(serveDevtoolsStore).toHaveBeenCalledWith(
			expect.objectContaining({
				getState: expect.any(Function),
			}),
			options,
		)
		expect(process.stdout.write).toHaveBeenCalledWith(url.href + `\n`)
	},
)

it.each([
	[[], /Provide a target URL or an entry module/],
	[[entry, `--bogus`], /Unknown option/],
	[[entry, `--port=654oops`], /port/],
	[[entry, `--port=65536`], /port/],
	[
		[resolve(import.meta.dirname, `../src/standalone-wire.ts`)],
		/default-export an Atom.io Silo/,
	],
] as const)(
	`rejects invocation %j without starting a listener`,
	async (args, diagnostic) => {
		await expect(launch(...args)).rejects.toBe(exit)
		expect(writeSync).toHaveBeenCalledWith(
			process.stderr.fd,
			expect.stringMatching(diagnostic),
		)
		expect(process.exit).toHaveBeenCalledWith(1)
		expect(serveDevtoolsStore).not.toHaveBeenCalled()
	},
)

it(`reports a startup rejection before exiting`, async () => {
	vi.mocked(serveDevtoolsStore).mockRejectedValueOnce(`Address unavailable`)
	await expect(launch(entry)).rejects.toBe(exit)
	expect(writeSync).toHaveBeenCalledWith(
		process.stderr.fd,
		`Address unavailable\n`,
	)
	expect(process.exit).toHaveBeenCalledWith(1)
})
