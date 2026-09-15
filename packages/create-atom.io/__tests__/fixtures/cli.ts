import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { stripVTControlCharacters } from "node:util"

const templates = [
	`preact-svg-editor`,
	`react-node-backend`,
	`react-realtime-text-editor`,
	`solid-lossless-numbers`,
]

const packageRoot = resolve(import.meta.dirname, `../..`)

export type CliFixture = {
	root: string
	cwd: string
	env: NodeJS.ProcessEnv
	installLog: string
	entry: string
}

export type CliOutput = { exitCode: number; stdout: string; stderr: string }

export async function makeCliFixture(): Promise<CliFixture> {
	const root = await mkdtemp(join(tmpdir(), `create-atom-cli-`))
	const cwd = join(root, `workspace`)
	const bin = join(root, `node_modules`, `.bin`)
	const installLog = join(root, `install.jsonl`)
	await mkdir(bin, { recursive: true })
	await mkdir(cwd)
	await writeFile(installLog, ``)
	// Put template packages above the working directory, as in an installed project.
	for (const template of templates) {
		const directory = join(
			root,
			`node_modules`,
			`@atom.io`,
			`template-${template}`,
		)
		await mkdir(join(directory, `src`), { recursive: true })
		await writeFile(
			join(directory, `package.json`),
			JSON.stringify({
				name: `@atom.io/template-${template}`,
				version: `0.0.0`,
			}),
		)
		await writeFile(join(directory, `src`, `template.txt`), template)
		await writeFile(join(directory, `README.md`), `Run npm run dev.\n`)
		await writeFile(join(directory, `_gitignore`), `node_modules\n`)
		await writeFile(join(directory, `mise.toml`), `[tools]\nnode = "old"\n`)
		if (template === `react-node-backend`) {
			await mkdir(join(directory, `node`, `nested`), { recursive: true })
			await writeFile(
				join(directory, `node`, `server.ts`),
				`#!/usr/bin/env node\n`,
				{ mode: 0o644 },
			)
			await writeFile(join(directory, `node`, `nested`, `data.txt`), `data`, {
				mode: 0o644,
			})
		}
	}
	for (const manager of [`npm`, `pnpm`, `bun`, `yarn`]) {
		await writeFile(
			join(bin, manager),
			`#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
fs.appendFileSync(process.env.CREATE_ATOM_TEST_INSTALL_LOG, JSON.stringify({ command: path.basename(process.argv[1]), args: process.argv.slice(2), cwd: process.cwd() }) + "\\n")
`,
			{ mode: 0o755 },
		)
	}
	const manifest = JSON.parse(
		await readFile(join(packageRoot, `package.json`), `utf8`),
	) as { bin: string }
	return {
		root,
		cwd,
		installLog,
		entry: resolve(packageRoot, manifest.bin),
		env: {
			...process.env,
			PATH: [bin, dirname(process.execPath), process.env[`PATH`]].join(
				delimiter,
			),
			CI: `false`,
			NO_COLOR: `1`,
			FORCE_COLOR: `0`,
			npm_config_user_agent: `npm`,
			CREATE_ATOM_TEST_INSTALL_LOG: installLog,
		},
	}
}

function execute(
	file: string,
	args: string[],
	fixture: CliFixture,
): Promise<CliOutput> {
	return new Promise((resolveOutput, reject) => {
		execFile(
			file,
			args,
			{ cwd: fixture.cwd, env: fixture.env, encoding: `utf8`, timeout: 12_000 },
			(error, stdout, stderr) => {
				if (error && (error.killed || typeof error.code !== `number`)) {
					reject(
						new Error(`${error.message}\n${stdout}\n${stderr}`, {
							cause: error,
						}),
					)
					return
				}
				resolveOutput({
					exitCode: typeof error?.code === `number` ? error.code : 0,
					stdout: stripVTControlCharacters(stdout),
					stderr: stripVTControlCharacters(stderr),
				})
			},
		)
	})
}

export function runCli(fixture: CliFixture, args: string[]): Promise<CliOutput> {
	return execute(process.execPath, [fixture.entry, ...args], fixture)
}

export async function runInteractiveCli(
	fixture: CliFixture,
	args: string[],
	steps: { waitFor: string; input: string }[],
): Promise<{ exitCode: number; output: string }> {
	// Resolve Bun before prepending the fixture's fake package-manager commands.
	let bun: string | undefined
	for (const directory of (process.env[`PATH`] ?? ``).split(delimiter)) {
		const candidate = join(directory, `bun`)
		try {
			await access(candidate, constants.X_OK)
			bun = candidate
			break
		} catch {
			continue
		}
	}
	if (!bun) throw new Error(`Bun is required for interactive CLI tests`)
	const { stdout, stderr, exitCode } = await execute(
		bun,
		[
			join(import.meta.dirname, `terminal.bun.ts`),
			JSON.stringify(steps),
			process.execPath,
			fixture.entry,
			...args,
		],
		fixture,
	)
	if (exitCode !== 0)
		throw new Error(`Terminal driver failed:\n${stdout}\n${stderr}`)
	return JSON.parse(stdout) as { exitCode: number; output: string }
}

export async function installations(
	fixture: CliFixture,
): Promise<{ command: string; args: string[]; cwd: string }[]> {
	return (await readFile(fixture.installLog, `utf8`))
		.trim()
		.split(`\n`)
		.filter(Boolean)
		.map((line) => JSON.parse(line))
}
