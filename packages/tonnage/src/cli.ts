#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { runTonnage } from "./run.ts"
import type { TonnageConfig, TonnageMode } from "./types.ts"

const DEFAULT_CONFIG_FILES = [
	`tonnage.config.ts`,
	`tonnage.config.mjs`,
	`tonnage.config.js`,
]

async function main(): Promise<void> {
	const command = process.argv[2]
	const mode = parseMode(command)
	const configPath = await findConfig(process.argv[3])
	const config = await loadConfig(configPath)
	const result = await runTonnage(config, {
		configDirectory: path.dirname(configPath),
		mode,
	})

	if (mode === `check` && result.changed) {
		process.stderr.write(
			`${path.relative(process.cwd(), result.readmePath)} is out of date. Run tonnage write.\n`,
		)
		process.exitCode = 1
		return
	}

	const readme = path.relative(process.cwd(), result.readmePath)
	process.stdout.write(
		result.changed
			? `Updated ${readme}.\n`
			: `${readme} is already up to date.\n`,
	)
}

function parseMode(command: string | undefined): TonnageMode {
	switch (command) {
		case `check`:
		case `test`:
			return `check`
		case `make`:
		case `write`:
			return `write`
		case undefined:
		default:
			throw new Error(`Usage: tonnage <write|check> [tonnage.config.ts]`)
	}
}

async function findConfig(configArgument: string | undefined): Promise<string> {
	if (configArgument) {
		return path.resolve(configArgument)
	}

	for (const filename of DEFAULT_CONFIG_FILES) {
		const candidate = path.resolve(filename)
		try {
			await fs.access(candidate)
			return candidate
		} catch {
			// Keep looking for the next supported config filename.
		}
	}

	throw new Error(
		`Could not find a tonnage config (${DEFAULT_CONFIG_FILES.join(`, `)}).`,
	)
}

async function loadConfig(configPath: string): Promise<TonnageConfig> {
	const imported = (await import(pathToFileURL(configPath).href)) as {
		default?: unknown
	}
	if (!imported.default || typeof imported.default !== `object`) {
		throw new Error(`${configPath} must default-export a tonnage config.`)
	}
	return imported.default
}

main().catch((error: unknown) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	)
	process.exitCode = 1
})
