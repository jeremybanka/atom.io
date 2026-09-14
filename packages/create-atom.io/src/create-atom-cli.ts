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

import type { CreateAtomOptionsPreloaded } from "./create-atom.ts"

const CREATE_ATOM_OPTS = options(
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

export async function runCreateAtomCli(argv: string[]): Promise<void> {
	const completion = await completionResponse(definition, argv)
	if (completion !== undefined) {
		process.stdout.write(completion)
		return
	}

	const parse = cli(definition, {
		// eslint-disable-next-line no-console
		error: console.error.bind(console),
		info: () => {},
	})
	const { inputs, warnings } = parse(argv)
	logWarnings(warnings)

	const { createAtom } = await import(`./create-atom.ts`)
	const argDir = inputs.path[0]
	await createAtom(argDir, inputs.opts)
}
