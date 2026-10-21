import { existsSync } from "node:fs"
import { resolve } from "node:path"

import * as prompts from "@clack/prompts"
import { cli, logWarnings, optional } from "comline"

import {
	CREATE_ATOM_OPTIONS,
	TEMPLATE_NAMES,
	TEMPLATES,
} from "./create-atom-options.ts"
import type { CreateAtomOptions, TemplateName } from "./create-atom-utils.ts"
import {
	color,
	getPkgManager,
	installDeps,
	scaffold,
	useSpinner,
} from "./create-atom-utils.ts"

const definition = {
	cliName: `create-atom.io`,
	routes: optional({ $projectName: null }),
	routeOptions: {
		"": CREATE_ATOM_OPTIONS,
		$projectName: CREATE_ATOM_OPTIONS,
	},
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
						options: TEMPLATE_NAMES.map((value) => ({
							label: TEMPLATES[value].label,
							value,
						})),
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
