import { fileURLToPath } from "node:url"

import { assembleReleasePlan } from "@changesets/assemble-release-plan"
import { readConfig } from "@changesets/config"
import { readPreState } from "@changesets/pre"
import { readChangesets } from "@changesets/read"
import { getPackages } from "@manypkg/get-packages"
import type { NpmConfig } from "breakage"

const root = fileURLToPath(new URL(`../`, import.meta.url))
let plan: Promise<Map<string, string>> | undefined
async function releasePlan(): Promise<Map<string, string>> {
	const packages = await getPackages(root)
	const { config, errors } = await readConfig(root, packages)
	if (errors) throw new Error(errors.join(`\n`))
	const [changesets, preState] = await Promise.all([
		readChangesets(root),
		readPreState(root),
	])
	const result = assembleReleasePlan(changesets, packages, config, preState)
	const versions = new Map<string, string>()
	for (const { name, newVersion } of result.releases) {
		if (newVersion) versions.set(name, newVersion)
	}
	return versions
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
