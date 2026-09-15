import {
	access,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { CliFixture } from "./fixtures/cli.ts"
import {
	installations,
	makeCliFixture,
	runCli,
	runInteractiveCli,
} from "./fixtures/cli.ts"

let fixture: CliFixture

beforeEach(async () => {
	fixture = await makeCliFixture()
})

afterEach(async () => {
	await rm(fixture.root, { recursive: true, force: true })
})

const suppliedOptions = [
	`--template=react-node-backend`,
	`--package-manager=pnpm`,
	`--use-mise=false`,
	`--skip-hints`,
]

describe(`one-shot CLI`, () => {
	it.each([
		{
			template: `preact-svg-editor`,
			manager: `npm`,
			flags: [`--templateName`, `--packageManager`, `--skipHints`, `--useMise`],
		},
		{
			template: `react-node-backend`,
			manager: `pnpm`,
			flags: [`--template`, `--package-manager`, `--skip-hints`, `--use-mise`],
		},
		{
			template: `react-realtime-text-editor`,
			manager: `bun`,
			flags: [`--template-name`, `-m`, `-k`, `--use-mise`],
		},
		{
			template: `solid-lossless-numbers`,
			manager: `yarn`,
			flags: [`-t`, `-m`, `-k`, `--useMise`],
		},
	])(
		`creates $template with $manager without prompting`,
		async ({ template, manager, flags }) => {
			const output = await runCli(fixture, [
				`${flags[0]}=${template}`,
				`${flags[1]}=${manager}`,
				flags[2],
				`${flags[3]}=true`,
				`my-app`,
			])
			const project = join(fixture.cwd, `my-app`)
			expect(output.exitCode, output.stderr + output.stdout).toBe(0)
			expect(output.stderr).toBe(``)
			expect(output.stdout).toContain(`You're all set!`)
			expect(output.stdout).not.toContain(`Template:`)
			expect(output.stdout).not.toContain(`Project directory:`)
			expect(output.stdout).not.toContain(`Would you like to use mise`)
			expect(output.stdout).not.toContain(`Getting Started`)
			expect(await readFile(join(project, `src`, `template.txt`), `utf8`)).toBe(
				template,
			)
			expect(await readFile(join(project, `README.md`), `utf8`)).toContain(
				manager === `bun` || manager === `npm`
					? `${manager} run dev`
					: `${manager} dev`,
			)
			expect(await readFile(join(project, `.gitignore`), `utf8`)).toBe(
				`node_modules\n`,
			)
			expect(await readFile(join(project, `mise.toml`), `utf8`)).toContain(
				`${manager === `npm` ? `node` : manager} = "@latest"`,
			)
			expect(await installations(fixture)).toEqual([
				{
					command: manager,
					args: manager === `yarn` ? [] : [`install`],
					cwd: project,
				},
			])
			if (template === `react-node-backend`) {
				expect(
					(await stat(join(project, `node`, `server.ts`))).mode & 0o777,
				).toBe(0o755)
				expect(
					(await stat(join(project, `node`, `nested`, `data.txt`))).mode & 0o111,
				).toBe(0)
			}
		},
	)

	it(`accepts separated option values after the directory and omits mise`, async () => {
		const output = await runCli(fixture, [
			`my-app`,
			`--template`,
			`preact-svg-editor`,
			`--package-manager`,
			`npm`,
			`--use-mise`,
			`false`,
		])
		expect(output.exitCode, output.stderr + output.stdout).toBe(0)
		expect(output.stdout).toContain(`Getting Started`)
		await expect(
			access(join(fixture.cwd, `my-app`, `mise.toml`)),
		).rejects.toThrow()
	})

	it.each([`--literal-directory`, `completion`, `create-atom`, ``])(
		`preserves the directory argument %j after the delimiter`,
		async (directory) => {
			const output = await runCli(fixture, [...suppliedOptions, `--`, directory])
			expect(output.exitCode, output.stderr + output.stdout).toBe(0)
			expect(output.stderr).toBe(``)
			expect(output.stdout).not.toContain(`Project directory:`)
			expect(
				await readFile(
					join(fixture.cwd, directory, `src`, `template.txt`),
					`utf8`,
				),
			).toBe(`react-node-backend`)
		},
	)

	it(`reports ignored options on stderr and still creates the project`, async () => {
		const output = await runCli(fixture, [
			...suppliedOptions,
			`my-app`,
			`--templat=unknown`,
			`-=malformed`,
		])
		expect(output.exitCode, output.stderr + output.stdout).toBe(0)
		expect(output.stderr).toContain(`--templat`)
		expect(output.stderr).toContain(`Unknown option "-"`)
		expect(output.stdout).not.toContain(`Warning:`)
		expect(
			await readFile(join(fixture.cwd, `my-app`, `src`, `template.txt`), `utf8`),
		).toBe(`react-node-backend`)
	})

	it(`rejects an invalid template without creating a project or installing`, async () => {
		const output = await runCli(fixture, [`my-app`, `--template=unknown`])
		expect(output.exitCode).not.toBe(0)
		expect(output.stderr).toContain(`templateName`)
		expect(output.stdout).toBe(``)
		expect(await readdir(fixture.cwd)).toEqual([])
		expect(await installations(fixture)).toEqual([])
	})

	it(`ignores both config filenames`, async () => {
		for (const filename of [
			`create-atom.config.json`,
			`create-atom.io.config.json`,
		]) {
			await writeFile(join(fixture.cwd, filename), `invalid json`)
		}
		const output = await runCli(fixture, [...suppliedOptions, `my-app`])
		expect(output.exitCode, output.stderr + output.stdout).toBe(0)
		expect(output.stderr).toBe(``)
		expect(
			await readFile(join(fixture.cwd, `my-app`, `src`, `template.txt`), `utf8`),
		).toBe(`react-node-backend`)
	})
})

describe(`interactive CLI`, () => {
	it(`asks for the template, directory, and mise choice, then creates the selected project`, async () => {
		const output = await runInteractiveCli(
			fixture,
			[],
			[
				{ waitFor: `Solid Lossless Numbers`, input: `\u001b[B\u001b[B\r` },
				{ waitFor: `Project directory:`, input: `interactive-app\r` },
				{ waitFor: `Would you like to use mise`, input: `n\r` },
			],
		)
		const project = join(fixture.cwd, `interactive-app`)
		expect(output.exitCode, output.output).toBe(0)
		expect(output.output).toContain(`You're all set!`)
		expect(output.output).toContain(`Getting Started`)
		expect(await readFile(join(project, `src`, `template.txt`), `utf8`)).toBe(
			`react-realtime-text-editor`,
		)
		await expect(access(join(project, `mise.toml`))).rejects.toThrow()
		expect(await installations(fixture)).toEqual([
			{ command: `npm`, args: [`install`], cwd: project },
		])
	}, 15_000)

	it(`asks only for the missing directory when options are already supplied`, async () => {
		const output = await runInteractiveCli(fixture, suppliedOptions, [
			{ waitFor: `Project directory:`, input: `my-app\r` },
		])
		expect(output.exitCode, output.output).toBe(0)
		expect(output.output).not.toContain(`Template:`)
		expect(output.output).not.toContain(`Would you like to use mise`)
		expect(output.output).not.toContain(`Getting Started`)
		expect(
			await readFile(join(fixture.cwd, `my-app`, `src`, `template.txt`), `utf8`),
		).toBe(`react-node-backend`)
	}, 15_000)

	it(`lets the user correct an existing directory without overwriting it`, async () => {
		await mkdir(join(fixture.cwd, `existing`))
		await writeFile(join(fixture.cwd, `existing`, `keep.txt`), `keep`)
		const output = await runInteractiveCli(fixture, suppliedOptions, [
			{ waitFor: `Project directory:`, input: `existing\r` },
			{
				waitFor: `Refusing to overwrite`,
				input: `-new\r`,
			},
		])
		expect(output.exitCode, output.output).toBe(0)
		expect(
			await readFile(join(fixture.cwd, `existing`, `keep.txt`), `utf8`),
		).toBe(`keep`)
		expect(await readdir(join(fixture.cwd, `existing`))).toEqual([`keep.txt`])
		expect(
			await readFile(
				join(fixture.cwd, `existing-new`, `src`, `template.txt`),
				`utf8`,
			),
		).toBe(`react-node-backend`)
	}, 15_000)

	it.each([
		{ args: [], prompt: `Solid Lossless Numbers` },
		{ args: suppliedOptions, prompt: `Project directory:` },
	])(
		`cancels at $prompt without creating a project`,
		async ({ args, prompt }) => {
			const output = await runInteractiveCli(fixture, args, [
				{ waitFor: prompt, input: `\u0003` },
			])
			expect(output.exitCode, output.output).toBe(0)
			expect(output.output).toContain(`Cancelled`)
			expect(await readdir(fixture.cwd)).toEqual([])
			expect(await installations(fixture)).toEqual([])
		},
		15_000,
	)
})
