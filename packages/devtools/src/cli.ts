#!/usr/bin/env node

import { writeSync } from "node:fs"

import { type } from "arktype"
import {
	cli,
	formatWarnings,
	help,
	helpOption,
	optional,
	options,
} from "comline"

import { serveRemoteViewer } from "./remote-viewer.ts"

const helpOptions = helpOption(`Show command help.`)
const parse = cli({
	cliName: `atom-io-devtools`,
	cliDescription: `Connect to an Atom.io Devtools server and open its viewer.`,
	routes: optional({ $target: null }),
	routeOptions: {
		"": helpOptions,
		$target: options(
			`Pass an HTTP(S) or WebSocket target URL. Set ATOM_IO_DEVTOOLS_TOKEN to the target's token.`,
			type({
				"help?": `boolean`,
				"port?": `0 <= number.integer <= 65535`,
			}),
			{
				help: helpOptions.optionConfigs.help,
				port: {
					description: `Loopback port. Use 0 or omit it to pick an available port.`,
					example: `--port 8123`,
					required: false,
					parse: (argument) => (/^\d+$/.test(argument) ? Number(argument) : NaN),
				},
			},
		),
	},
})

async function main(): Promise<void> {
	const { inputs, warnings } = parse(process.argv)
	if (warnings.length) throw new Error(formatWarnings(warnings))
	if (inputs.opts.help) {
		process.stdout.write(help(parse.definition) + `\n`)
		return
	}
	if (inputs.case !== `$target` || !inputs.params.target) {
		throw new Error(
			`Provide a Devtools target URL. Run atom-io-devtools --help for usage.`,
		)
	}
	const { target } = inputs.params
	const { port = 0 } = inputs.opts
	const viewer = await serveRemoteViewer(
		target,
		process.env[`ATOM_IO_DEVTOOLS_TOKEN`],
		port,
	)
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
