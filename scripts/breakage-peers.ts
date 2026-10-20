import { execFile } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { NpmConfig } from "breakage"

const execute = promisify(execFile)
const root = fileURLToPath(new URL(`../`, import.meta.url))
let plan: Promise<Map<string, string>> | undefined
async function releasePlan(): Promise<Map<string, string>> {
	const directory = await mkdtemp(join(tmpdir(), `atomio-release-plan-`))
	const filename = join(directory, `plan.json`)
	try {
		await execute(
			join(root, `node_modules/.bin/changeset`),
			[`status`, `--output`, filename],
			{ cwd: root },
		)
		const result = JSON.parse(await readFile(filename, `utf8`)) as {
			releases: { name: string; newVersion: string }[]
		}
		return new Map(
			result.releases.map(({ name, newVersion }) => [name, newVersion]),
		)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

export const releaseIntent: NonNullable<NpmConfig[`releaseIntent`]> = async ({
	packageName,
	currentVersion,
}) => {
	plan ??= releasePlan()
	// Pending Changesets take precedence. Once versioning consumes them, the
	// manifest is the exact target for the coordinated build being exercised.
	const version = (await plan).get(packageName) ?? currentVersion
	return { status: `release`, version }
}

export const certifyBreaking: NonNullable<NpmConfig[`certifyBreaking`]> = ({
	previousVersion,
	release,
}) =>
	release.delta === `major` ||
	(previousVersion.startsWith(`0.`) && release.delta === `minor`)
