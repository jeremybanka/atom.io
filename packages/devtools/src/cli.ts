#!/usr/bin/env node

import { writeSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { type } from "arktype"
import type { Silo } from "atom.io"
import {
	cli,
	formatWarnings,
	help,
	helpOption,
	optional,
	options,
	parseBooleanOption,
} from "comline"

import { serveDevtoolsStore } from "./standalone.ts"

const helpOptions = helpOption(`Show command help.`)
const parse = cli({
	cliName: `atom-io-devtools`,
	cliDescription: `Open the printed URL to inspect an Atom.io Silo.`,
	routes: optional({ $entry: null }),
	routeOptions: {
		"": helpOptions,
		$entry: options(
			`Load a module that default-exports an Atom.io Silo.`,
			type({
				"help?": `boolean`,
				"port?": `0 <= number.integer <= 65535`,
				"allow-production?": `boolean`,
			}),
			{
				help: helpOptions.optionConfigs.help,
				port: {
					description: `Loopback port. Use 0 or omit it to pick an available port.`,
					example: `--port 8123`,
					required: false,
					parse: (argument) => (/^\d+$/.test(argument) ? Number(argument) : NaN),
				},
				"allow-production": {
					description: `Permit inspection in production.`,
					example: `--allow-production`,
					required: false,
					parse: parseBooleanOption,
				},
			},
		),
	},
})

// The entry and the CLI can resolve separate copies of atom.io.
function isSilo(value: unknown): value is Silo {
	const silo = value as Partial<Silo> | null | undefined
	const store = silo?.store
	return (
		typeof silo?.atom === `function` &&
		typeof silo.getState === `function` &&
		typeof store?.config?.isProduction === `boolean` &&
		store.parent === null &&
		store.atoms instanceof Map &&
		store.valueMap instanceof Map
	)
}

async function main(): Promise<void> {
	const { inputs, warnings } = parse(process.argv)
	if (warnings.length) throw new Error(formatWarnings(warnings))
	if (inputs.opts.help) {
		process.stdout.write(help(parse.definition) + `\n`)
		return
	}
	if (inputs.case !== `$entry` || !inputs.params.entry) {
		throw new Error(
			`Provide an entry module. Run atom-io-devtools --help for usage.`,
		)
	}
	const { default: silo } = await import(
		pathToFileURL(resolve(inputs.params.entry)).href
	)
	if (!isSilo(silo))
		throw new Error(`The entry module must default-export an Atom.io Silo`)

	const { port = 0, "allow-production": allowProduction } = inputs.opts
	const viewer = await serveDevtoolsStore(silo, {
		port,
		...(allowProduction ? { productionAccess: `inspect` } : {}),
	})
	process.stdout.write(viewer.url.href + `\n`)
}

try {
	await main()
} catch (error) {
	writeSync(
		process.stderr.fd,
		(error instanceof Error ? error.message : String(error)) + `\n`,
	)
	process.exit(1)
}
