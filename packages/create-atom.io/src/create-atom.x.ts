import { existsSync } from "node:fs"
import { resolve } from "node:path"

import * as prompts from "@clack/prompts"
import { type } from "arktype"
import type { OptionsGroup } from "comline"
import {
	cli,
	completionResponse,
	logWarnings,
	optional,
	options,
	parseBooleanOption,
} from "comline"

import type {
	CreateAtomOptions,
	CreateAtomOptionsPreloaded,
	TemplateName,
} from "./create-atom-utils"
import {
	color,
	getPkgManager,
	installDeps,
	scaffold,
	useSpinner,
} from "./create-atom-utils"

const CREATE_ATOM_OPTIONS = options(
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
		"": CREATE_ATOM_OPTIONS,
		$projectName: CREATE_ATOM_OPTIONS,
	},
}

const completion = await completionResponse(definition, process.argv)
if (completion !== undefined) {
	process.stdout.write(completion)
	process.exit(0)
}

const parse = cli(definition, {
	// eslint-disable-next-line no-console
	error: console.error.bind(console),
	info: () => {},
})
const { inputs, warnings } = parse(process.argv)
logWarnings(warnings)

const argDir = inputs.path[0]
const preloaded = inputs.opts
const skipHint = preloaded.skipHints ?? false
const packageManager = preloaded.packageManager ?? getPkgManager()

prompts.intro(color(`greenBright`, `atom.io - Data Components for TypeScript`))

const { dir, templateName, useMise } = await prompts.group(
	{
		templateName: () =>
			preloaded.templateName === undefined
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
				: Promise.resolve(preloaded.templateName),
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
			preloaded.useMise === undefined
				? prompts.confirm({
						message: `Would you like to use mise to manage your environment? (https://mise.jdx.dev)`,
						initialValue: true,
					})
				: Promise.resolve(preloaded.useMise),
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
	prompts.note(gettingStarted.trim().replace(/^\t\t\t/gm, ``), `Getting Started`)
}

prompts.outro(color(`green`, `You're all set!`))
