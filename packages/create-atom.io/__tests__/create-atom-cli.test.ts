import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { MockInstance } from "vitest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { runCreateAtomCli } from "../src/create-atom-cli.ts"

const { createAtom } = vi.hoisted(() => ({
	createAtom: vi.fn().mockResolvedValue(undefined),
}))

vi.mock(`../src/create-atom.ts`, () => ({ createAtom }))

let workingDirectory: string
let warningLog: MockInstance<typeof console.warn>

beforeEach(() => {
	vi.clearAllMocks()
	workingDirectory = mkdtempSync(join(tmpdir(), `create-atom-cli-`))
	vi.spyOn(process, `cwd`).mockReturnValue(workingDirectory)
	vi.spyOn(process.stdout, `write`).mockReturnValue(true)
	warningLog = vi.spyOn(console, `warn`).mockImplementation(() => {})
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(workingDirectory, { recursive: true, force: true })
})

function invoke(...words: string[]): Promise<void> {
	return runCreateAtomCli([process.execPath, `/bin/create-atom.io`, ...words])
}

function stdout(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map(([text]) => text)
		.join(``)
}

describe(`CLI options`, () => {
	it.each([
		[`--templateName`, `--packageManager`, `--skipHints`, `--useMise`],
		[`--template`, `--package-manager`, `--skip-hints`, `--use-mise`],
		[`--template-name`, `-m`, `-k`, `--use-mise`],
		[`-t`, `-m`, `-k`, `--useMise`],
	])(
		`accepts %s and its companion flags`,
		async (template, manager, hints, mise) => {
			await invoke(
				`${template}=react-node-backend`,
				`${manager}=pnpm`,
				hints,
				`${mise}=false`,
				`my-app`,
			)

			expect(createAtom).toHaveBeenCalledExactlyOnceWith(`my-app`, {
				templateName: `react-node-backend`,
				packageManager: `pnpm`,
				skipHints: true,
				useMise: false,
			})
			expect(warningLog).not.toHaveBeenCalled()
		},
	)

	it(`accepts options after the project name and separated values`, async () => {
		await invoke(
			`my-app`,
			`--template`,
			`preact-svg-editor`,
			`--use-mise`,
			`false`,
		)
		expect(createAtom).toHaveBeenCalledExactlyOnceWith(`my-app`, {
			templateName: `preact-svg-editor`,
			useMise: false,
		})
	})

	it(`leaves the project name optional without consuming it as a boolean`, async () => {
		await invoke(`--skip-hints`)
		expect(createAtom).toHaveBeenCalledExactlyOnceWith(undefined, {
			skipHints: true,
		})
		createAtom.mockClear()
		await invoke(`--skip-hints`, `my-app`)
		expect(createAtom).toHaveBeenCalledExactlyOnceWith(`my-app`, {
			skipHints: true,
		})
	})

	it.each([`--literal-directory`, `completion`, `create-atom`])(
		`preserves the literal project name %s after the delimiter`,
		async (projectName) => {
			await invoke(`--skip-hints`, `--`, projectName)
			expect(createAtom).toHaveBeenCalledExactlyOnceWith(projectName, {
				skipHints: true,
			})
			expect(warningLog).not.toHaveBeenCalled()
		},
	)

	it(`warns about ignored options before starting the initializer`, async () => {
		await invoke(`my-app`, `--templat=react-node-backend`, `-=malformed`)
		const warning = warningLog
		expect(warning).toHaveBeenCalledOnce()
		expect(warning.mock.calls[0]?.[0]).toContain(`--templat`)
		expect(warning.mock.calls[0]?.[0]).toContain(`create-atom.io my-app`)
		expect(warning.mock.calls[0]?.[0]).toContain(`Unknown option "-"`)
		expect(warning.mock.invocationCallOrder[0]).toBeLessThan(
			createAtom.mock.invocationCallOrder[0],
		)
		expect(createAtom).toHaveBeenCalledExactlyOnceWith(`my-app`, {})
		expect(stdout()).toBe(``)
	})

	it(`rejects invalid alias values before starting the initializer`, async () => {
		await expect(invoke(`my-app`, `--template=unknown`)).rejects.toThrow()
		expect(createAtom).not.toHaveBeenCalled()
	})

	it(`ignores config files and uses command-line options`, async () => {
		for (const filename of [
			`create-atom.config.json`,
			`create-atom.io.config.json`,
		]) {
			writeFileSync(join(workingDirectory, filename), `invalid json`)
		}
		await invoke(`my-app`, `--package-manager=pnpm`, `--use-mise=false`)
		expect(createAtom).toHaveBeenCalledExactlyOnceWith(`my-app`, {
			packageManager: `pnpm`,
			useMise: false,
		})
	})
})

describe(`shell completion`, () => {
	it.each([`bash`, `zsh`, `fish`, `nushell`, `carapace`])(
		`generates the %s integration for the installed binary without initializing`,
		async (target) => {
			await invoke(`completion`, target)
			expect(stdout()).toContain(`create-atom.io`)
			expect(createAtom).not.toHaveBeenCalled()
			expect(warningLog).not.toHaveBeenCalled()
		},
	)

	it.each([
		{
			words: [`--template=react-`],
			expected: [`react-node-backend`, `react-realtime-text-editor`],
		},
		{ words: [`my-app`, `--package-manager`, `p`], expected: [`pnpm`] },
		{ words: [`--use-mise`, `f`], expected: [`false`] },
		{ words: [`--skip-`], expected: [`--skip-hints`] },
		{
			words: [`completion`, `install`, ``],
			expected: [`bash`, `zsh`, `fish`, `nushell`, `carapace`],
		},
	])(
		`completes $words using the CLI definition`,
		async ({ words, expected }) => {
			await invoke(`__completeNoDesc`, ...words)
			expect(stdout().trim().split(`\n`)).toEqual(
				expect.arrayContaining(expected),
			)
			expect(createAtom).not.toHaveBeenCalled()
			expect(warningLog).not.toHaveBeenCalled()
		},
	)
})
