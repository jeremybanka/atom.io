#!/usr/bin/env node

import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"

import { Silo } from "atom.io"

import { serveDevtoolsStore } from "./standalone.ts"

const usage = [
	`Usage: atom-io-devtools [--port PORT] [--allow-production] <entry>`,
	``,
	`The entry module must default-export an Atom.io Silo. Open the printed URL to inspect it.`,
	`If omitted, the port is chosen automatically.`,
].join(`\n`)

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			help: { type: `boolean`, short: `h` },
			port: { type: `string` },
			"allow-production": { type: `boolean` },
		},
	})
	if (values.help) {
		process.stdout.write(usage + `\n`)
		return
	}
	const [entry] = positionals
	if (!entry || positionals.length !== 1) throw new Error(usage)
	const port = Number(values.port ?? 0)
	if (
		(values.port !== undefined && !/^\d+$/.test(values.port)) ||
		!Number.isInteger(port) ||
		port > 65535
	) {
		throw new Error(`Use a port from 0 to 65535`)
	}
	const { default: silo } = await import(pathToFileURL(resolve(entry)).href)
	if (!(silo instanceof Silo))
		throw new Error(`The entry module must default-export an Atom.io Silo`)

	const viewer = await serveDevtoolsStore(silo, {
		port,
		...(values[`allow-production`] ? { productionAccess: `inspect` } : {}),
	})
	process.stdout.write(viewer.url.href + `\n`)
}

try {
	await main()
} catch (error) {
	process.stderr.write(
		(error instanceof Error ? error.message : String(error)) + `\n`,
	)
	process.exitCode = 1
}
