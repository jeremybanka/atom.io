#!/usr/bin/env node

import { existsSync, promises as fs } from "node:fs"
import { resolve } from "node:path"
import { styleText } from "node:util"

import * as prompts from "@clack/prompts"
import { type } from "arktype"
import type { OptionsGroup } from "comline"
import {
	cli,
	completionResponse,
	logWarnings,
	optional,
	options as defineOptions,
	parseBooleanOption,
} from "comline"
import { getPackageInfo } from "local-pkg"
import { x } from "tinyexec"

const CREATE_ATOM_OPTS = defineOptions(
	`Create a new project with atom.io.`,
	type({
		"packageManager?": `"bun" | "npm" | "pnpm" | "yarn"`,
		"templateName?": `"preact-svg-editor" | "react-node-backend" | "react-realtime-text-editor" | "solid-lossless-numbers"`,
		"skipHints?": `boolean`,
		"useMise?": `boolean`,
	}),
	{
		packageManager: {
			flag: `m`,
			aliases: [`package-manager`],
			required: false,
			description: `The package manager to use.`,
			example: `--packageManager="npm"`,
		},
		templateName: {
			flag: `t`,
			aliases: [`template`, `template-name`],
			required: false,
			description: `The template to use.`,
			example: `--templateName="preact-svg-editor"`,
		},
		skipHints: {
			flag: `k`,
			aliases: [`skip-hints`],
			required: false,
			description: `Silences the 'Getting Started' info, mainly for use in other initializers that may wrap this one but provide their own scripts/instructions.`,
			example: `--skipHints`,
			parse: parseBooleanOption,
		},
		useMise: {
			aliases: [`use-mise`],
			required: false,
			description: `Include mise.toml for managing the project environment.`,
			example: `--useMise=true`,
			parse: parseBooleanOption,
		},
	},
) satisfies OptionsGroup<CreateAtomOptionsPreloaded>

const definition = {
	cliName: `create-atom.io`,
	discoverConfigPath: () => undefined,
	routes: optional({ $projectName: null }),
	routeOptions: {
		"": CREATE_ATOM_OPTS,
		$projectName: CREATE_ATOM_OPTS,
	},
}

async function main(): Promise<void> {
	const completion = await completionResponse(definition, process.argv)
	if (completion !== undefined) {
		process.stdout.write(completion)
		return
	}

	const parse = cli(definition, {
		// eslint-disable-next-line no-console
		error: console.error.bind(console),
		info: () => {},
	})
	const { inputs, warnings } = parse(process.argv)
	logWarnings(warnings)

	const argDir = inputs.path[0]
	await createAtom(argDir, inputs.opts)
}

const color = (format: Parameters<typeof styleText>[0], text: string): string =>
	styleText(format, text, { validateStream: false })

type PackageManager = `bun` | `npm` | `pnpm` | `yarn`
type TemplateName =
	| `preact-svg-editor`
	| `react-node-backend`
	| `react-realtime-text-editor`
	| `solid-lossless-numbers`

type CreateAtomOptions = {
	packageManager: PackageManager
	templateName: TemplateName
	useMise: boolean
}

type CreateAtomOptionsPreloaded = {
	[K in keyof CreateAtomOptions]?: CreateAtomOptions[K] | undefined
} & { skipHints?: boolean | undefined }

async function createAtom(
	argDir: string | undefined,
	options: CreateAtomOptionsPreloaded,
): Promise<void> {
	const skipHint = options.skipHints ?? false
	const packageManager = options.packageManager ?? getPkgManager()

	prompts.intro(color(`greenBright`, `atom.io - Data Components for TypeScript`))

	const { dir, templateName, useMise } = await prompts.group(
		{
			templateName: () =>
				options.templateName === undefined
					? prompts.select<TemplateName>({
							message: `Template:`,
							initialValue: `preact-svg-editor`,
							options: [
								{
									label: `Preact SVG Editor`,
									value: `preact-svg-editor`,
								},
								{
									label: `React Node Backend`,
									value: `react-node-backend`,
								},
								{
									label: `React Realtime Text Editor`,
									value: `react-realtime-text-editor`,
								},
								{
									label: `Solid Lossless Numbers`,
									value: `solid-lossless-numbers`,
								},
							],
						})
					: Promise.resolve(options.templateName),
			dir: () =>
				argDir === undefined
					? prompts.text({
							message: `Project directory:`,
							placeholder: `my-app`,
							validate(value) {
								if (value === undefined || value.length === 0) {
									return `Directory name is required!`
								}
								if (existsSync(value)) {
									return `Refusing to overwrite existing directory or file! Please provide a non-clashing name.`
								}
							},
						})
					: Promise.resolve(argDir),
			useMise: () =>
				options.useMise === undefined
					? prompts.confirm({
							message: `Would you like to use mise to manage your environment? (https://mise.jdx.dev)`,
							initialValue: true,
						})
					: Promise.resolve(options.useMise),
		},
		{
			onCancel: () => {
				prompts.cancel(color(`yellow`, `Cancelled`))
				process.exit(0)
			},
		},
	)
	const targetDir = resolve(process.cwd(), dir)
	const opts: CreateAtomOptions = { packageManager, templateName, useMise }

	await useSpinner(
		`Setting up your project directory...`,
		() => scaffold(targetDir, opts),
		`Set up project directory`,
	)

	await useSpinner(
		`Installing project dependencies...`,
		() => installDeps(targetDir, opts),
		`Installed project dependencies`,
	)

	if (skipHint === false) {
		const gettingStarted = `
			${color(`dim`, `$`)} ${color(`blueBright`, `cd ${dir}`)}
			${useMise ? `${color(`dim`, `$`)} ${color(`blueBright`, `mise install`)}` : ``}
			${color(`dim`, `$`)} ${color(
				`blueBright`,
				`${
					packageManager === `npm`
						? `npm run`
						: packageManager === `bun`
							? `bun run`
							: packageManager
				} dev`,
			)}
		`
		prompts.note(
			gettingStarted.trim().replace(/^\t\t\t/gm, ``),
			`Getting Started`,
		)
	}

	prompts.outro(color(`green`, `You're all set!`))
}

async function useSpinner(
	startMessage: string,
	fn: () => Promise<void>,
	finishMessage: string,
): Promise<void> {
	const s = prompts.spinner()
	s.start(startMessage)
	await fn()
	s.stop(color(`green`, finishMessage))
}

async function scaffold(
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
async function makeTemplateDir(
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

async function installDeps(to: string, opts: CreateAtomOptions) {
	const dependencies: string[] = []
	const devDependencies: string[] = []

	const installOpts = {
		packageManager: opts.packageManager,
		to,
	}

	await installPackages(dependencies, { ...installOpts })
	devDependencies.length &&
		(await installPackages(devDependencies, { ...installOpts, dev: true }))
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

function getPkgManager(): `bun` | `npm` | `pnpm` | `yarn` {
	const userAgent = process.env[`npm_config_user_agent`] ?? ``
	if (userAgent.startsWith(`yarn`)) return `yarn`
	if (userAgent.startsWith(`pnpm`)) return `pnpm`
	if (userAgent.startsWith(`bun`)) return `bun`
	return `npm`
}

await main()
