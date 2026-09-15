import { promises as fs } from "node:fs"
import { resolve } from "node:path"
import { styleText } from "node:util"

import * as prompts from "@clack/prompts"
import { getPackageInfo } from "local-pkg"
import { x } from "tinyexec"

export const color = (
	format: Parameters<typeof styleText>[0],
	text: string,
): string => styleText(format, text, { validateStream: false })

type PackageManager = `bun` | `npm` | `pnpm` | `yarn`
export type TemplateName =
	| `preact-svg-editor`
	| `react-node-backend`
	| `react-realtime-text-editor`
	| `solid-lossless-numbers`

export type CreateAtomOptions = {
	packageManager: PackageManager
	templateName: TemplateName
	useMise: boolean
}

export type CreateAtomOptionsPreloaded = {
	[K in keyof CreateAtomOptions]?: CreateAtomOptions[K] | undefined
} & { skipHints?: boolean | undefined }

export async function useSpinner(
	startMessage: string,
	fn: () => Promise<void>,
	finishMessage: string,
): Promise<void> {
	const s = prompts.spinner()
	s.start(startMessage)
	await fn()
	s.stop(color(`green`, finishMessage))
}

export async function scaffold(
	directoryToCreate: string,
	opts: CreateAtomOptions,
): Promise<void> {
	await fs.mkdir(directoryToCreate, { recursive: true })

	const templateInfo = await getPackageInfo(
		`@atom.io/template-${opts.templateName}`,
		{
			paths: [process.cwd(), import.meta.dirname],
		},
	)
	if (!templateInfo) throw new Error(`Could not find template package`)
	const { rootPath } = templateInfo
	await makeTemplateDir(rootPath, directoryToCreate, opts)
	const nodeDirPath = resolve(directoryToCreate, `node`)
	await makeFileContentsExecutable(nodeDirPath)
}

/**
 * Recursive fs copy, swiped from `create-wmr`:
 * https://github.com/preactjs/wmr/blob/3c5672ecd2f958c8eaf372d33c084dc69228ae3f/packages/create-wmr/src/index.js#L108-L124
 */
export async function makeTemplateDir(
	from: string,
	to: string,
	opts: CreateAtomOptions,
): Promise<void[]> {
	const files = await fs.readdir(from)
	const results = await Promise.all(
		files.map(async (f) => {
			if (f === `.` || f === `..`) return
			const filename = resolve(from, f)
			if ((await fs.stat(filename)).isDirectory()) {
				await fs.mkdir(resolve(to, f), { recursive: true })
				return makeTemplateDir(filename, resolve(to, f), opts)
			}
			if (opts.packageManager !== `npm` && f === `README.md`) {
				await fs.writeFile(
					resolve(to, f),
					(await fs.readFile(filename, `utf-8`)).replace(
						/npm run/g,
						opts.packageManager === `bun` ? `bun run` : opts.packageManager,
					),
				)
				return
			}
			if (opts.useMise === false && f === `mise.toml`) return
			if (f === `mise.toml`) {
				await fs.writeFile(resolve(to, f), createMiseToml(opts.packageManager))
				return
			}
			// Publishing to npm renames the .gitignore to .npmignore
			// https://github.com/npm/npm/issues/7252#issuecomment-253339460
			if (f === `_gitignore`) f = `.gitignore`
			await fs.copyFile(filename, resolve(to, f))
		}),
	)
	return results.flat(99)
}

async function makeFileContentsExecutable(
	directoryPath: string,
): Promise<string[]> {
	try {
		await fs.access(directoryPath)
	} catch {
		return []
	}

	const nodeDir = await fs.stat(directoryPath)
	if (!nodeDir.isDirectory()) return []

	const nodeFiles = await fs.readdir(directoryPath, { withFileTypes: true })

	return Promise.all(
		nodeFiles
			.filter((dirent) => dirent.isFile())
			.map(async (dirent) => {
				const filename = resolve(directoryPath, dirent.name)
				await fs.chmod(filename, 0o755)
				return filename
			}),
	)
}

function createMiseToml(packageManager: PackageManager): string {
	switch (packageManager) {
		case `bun`:
			return [`[tools]`, `bun = "@latest"`, ``].join(`\n`)
		case `npm`:
			return [`[tools]`, `node = "@latest"`, `npm = "@latest"`, ``].join(`\n`)
		case `pnpm`:
			return [`[tools]`, `node = "@latest"`, `pnpm = "@latest"`, ``].join(`\n`)
		case `yarn`:
			return [`[tools]`, `node = "@latest"`, `yarn = "@latest"`, ``].join(`\n`)
	}
}

export async function installDeps(
	to: string,
	opts: CreateAtomOptions,
): Promise<void> {
	const dependencies: string[] = []
	const devDependencies: string[] = []

	const installOpts = {
		packageManager: opts.packageManager,
		to,
	}

	await installPackages(dependencies, { ...installOpts })

	if (devDependencies.length > 0) {
		await installPackages(devDependencies, { ...installOpts, dev: true })
	}
}

type InstallOptions = {
	packageManager: `bun` | `npm` | `pnpm` | `yarn`
	to: string
	dev?: boolean
}

function installPackages(pkgs: string[], opts: InstallOptions) {
	return x(
		opts.packageManager,
		[
			// `yarn add` will fail if nothing is provided
			opts.packageManager === `yarn` ? (pkgs.length ? `add` : ``) : `install`,
			opts.dev ? `-D` : ``,
			...pkgs,
		].filter(Boolean),
		{
			nodeOptions: {
				stdio: `ignore`,
				cwd: opts.to,
			},
		},
	)
}

export function getPkgManager(): `bun` | `npm` | `pnpm` | `yarn` {
	const userAgent = process.env[`npm_config_user_agent`] ?? ``
	if (userAgent.startsWith(`yarn`)) return `yarn`
	if (userAgent.startsWith(`pnpm`)) return `pnpm`
	if (userAgent.startsWith(`bun`)) return `bun`
	return `npm`
}
