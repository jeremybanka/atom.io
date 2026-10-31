import { type } from "arktype"
import type { OptionsGroup } from "comline"
import { options, parseBooleanOption } from "comline"

export const TEMPLATES = {
	"spa-astro-ssr": {
		label: `SPA Astro SSR`,
		description: `An Astro app with SPA, SQLite-backed atom defaults, and fresh browser values on reset.`,
	},
	"preact-realtime-vector-editor": {
		label: `Preact Realtime Vector Editor`,
		description: `A Preact vector editor with Mosaic Domain batching, presence, recovery, and actor-safe history.`,
	},
	"preact-svg-editor": {
		label: `Preact SVG Editor`,
		description: `A Preact + Vite SVG editor that leans on atoms, atom families, selectors, and transactions.`,
	},
	"react-node-backend": {
		label: `React Node Backend`,
		description: `A React app paired with Node services for backend-shaped examples.`,
	},
	"react-realtime-text-editor": {
		label: `React Realtime Text Editor`,
		description: `A realtime React text editor with presence and selective per-user undo.`,
	},
	"solid-lossless-numbers": {
		label: `Solid Lossless Numbers`,
		description: `A Solid + Vite playground for exact rational arithmetic with @atom.io/solid.`,
	},
} as const

export type TemplateName = keyof typeof TEMPLATES
export const TEMPLATE_NAMES: TemplateName[] = Object.keys(
	TEMPLATES,
) as TemplateName[]
export const PACKAGE_MANAGERS = [`bun`, `npm`, `pnpm`, `yarn`] as const
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]
export type CreateAtomOptions = {
	packageManager: PackageManager
	templateName: TemplateName
	useMise: boolean
}
export type CreateAtomOptionsPreloaded = {
	[K in keyof CreateAtomOptions]?: CreateAtomOptions[K] | undefined
} & { skipHints?: boolean | undefined }

export const OPTION_VALUES: {
	packageManager: readonly PackageManager[]
	templateName: readonly TemplateName[]
	skipHints: readonly boolean[]
	useMise: readonly boolean[]
} = {
	packageManager: PACKAGE_MANAGERS,
	templateName: TEMPLATE_NAMES,
	skipHints: [true, false],
	useMise: [true, false],
}

export const CREATE_ATOM_OPTIONS: OptionsGroup<CreateAtomOptionsPreloaded> =
	options(
		`Create a new project with atom.io.`,
		type({
			"packageManager?": type.enumerated(...OPTION_VALUES.packageManager),
			"templateName?": type.enumerated(...OPTION_VALUES.templateName),
			"skipHints?": type.enumerated(...OPTION_VALUES.skipHints),
			"useMise?": type.enumerated(...OPTION_VALUES.useMise),
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
	)
