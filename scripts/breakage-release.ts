import { assembleReleasePlan } from "@changesets/assemble-release-plan"
import { readConfig } from "@changesets/config"
import { readPreState } from "@changesets/pre"
import { readChangesets } from "@changesets/read"
import { getPackages } from "@manypkg/get-packages"
import type { NpmConfig } from "breakage"

async function releasePlan(root: string): Promise<Map<string, string>> {
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

export function createReleaseIntent(
	root: string,
): NonNullable<NpmConfig[`releaseIntent`]> {
	let plan: Promise<Map<string, string>> | undefined
	return async ({ packageName, currentVersion }) => {
		plan ??= releasePlan(root)
		// Pending Changesets take precedence. Once versioning consumes them, the
		// manifest is the exact target for the coordinated build being exercised.
		const version = (await plan).get(packageName) ?? currentVersion
		return { status: `release`, version }
	}
}

export const certifyBreaking: NonNullable<NpmConfig[`certifyBreaking`]> = ({
	previousVersion,
	release,
}) =>
	release.delta === `major` ||
	(previousVersion.startsWith(`0.`) && release.delta === `minor`)
