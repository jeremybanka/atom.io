// @vitest-environment node

import { writeSync } from "node:fs"

import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { serveRemoteViewer } from "../src/remote-viewer.ts"

vi.mock(`node:fs`, { spy: true })
vi.mock(`../src/remote-viewer.ts`, () => ({ serveRemoteViewer: vi.fn() }))

const target = `https://example.test`
const exit = new Error(`CLI exited`)
const url = new URL(`http://127.0.0.1:12345/viewer/`)

beforeEach(() => {
	vi.resetModules()
	vi.spyOn(process.stdout, `write`).mockReturnValue(true)
	vi.spyOn(process, `exit`).mockImplementation(() => {
		throw exit
	})
	vi.mocked(writeSync).mockReturnValue(0)
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

it(`prints generated help without connecting to a target`, async () => {
	await launch(`-h`)
	expect(process.stdout.write).toHaveBeenCalledWith(
		expect.stringContaining(`atom-io-devtools <target>`),
	)
	expect(serveRemoteViewer).not.toHaveBeenCalled()
	expect(process.exit).not.toHaveBeenCalled()
})

it.each([
	[[], 0],
	[[`--port`, `8123`], 8123],
] as const)(
	`connects to the target server with options %j`,
	async (args, port) => {
		vi.stubEnv(`ATOM_IO_DEVTOOLS_TOKEN`, `test-token`)
		await launch(target, ...args)
		expect(serveRemoteViewer).toHaveBeenCalledWith(target, `test-token`, port)
		expect(process.stdout.write).toHaveBeenCalledWith(url.href + `\n`)
	},
)

it.each([
	[[], /Provide a Devtools target URL/],
	[[target, `--allow-production`], /Unknown option/],
	[[target, `--port=654oops`], /port/],
	[[target, `--port=65536`], /port/],
] as const)(
	`rejects invocation %j without starting a listener`,
	async (args, diagnostic) => {
		await expect(launch(...args)).rejects.toBe(exit)
		expect(writeSync).toHaveBeenCalledWith(
			process.stderr.fd,
			expect.stringMatching(diagnostic),
		)
		expect(process.exit).toHaveBeenCalledWith(1)
		expect(serveRemoteViewer).not.toHaveBeenCalled()
	},
)

it(`reports a startup rejection before exiting`, async () => {
	vi.mocked(serveRemoteViewer).mockRejectedValueOnce(`Address unavailable`)
	await expect(launch(target)).rejects.toBe(exit)
	expect(writeSync).toHaveBeenCalledWith(
		process.stderr.fd,
		`Address unavailable\n`,
	)
	expect(process.exit).toHaveBeenCalledWith(1)
})
