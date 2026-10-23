import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

import type { BreakageBaseline } from "breakage"
import { diff, gt, valid } from "semver"

import { certifyBreaking, createReleaseIntent } from "./breakage-release.ts"

const directory = process.cwd()
const git = (...args: string[]) =>
	execFileSync(`git`, args, { cwd: directory, encoding: `utf8` }).trim()
const root = git(`rev-parse`, `--show-toplevel`)
const baseline: BreakageBaseline = JSON.parse(
	await readFile(path.join(directory, `.breakage/baseline.json`), `utf8`),
)
assert.equal(baseline.version, 1, `Unsupported baseline format.`)
assert.equal(baseline.packageDirectory, git(`rev-parse`, `--show-prefix`))
assert.match(baseline.commit, /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/)
const previous = JSON.parse(
	git(`show`, `${baseline.commit}:${baseline.packageDirectory}package.json`),
) as { name: string; version: string }
const current = JSON.parse(
	await readFile(path.join(directory, `package.json`), `utf8`),
) as { name: string; version: string }
assert.equal(previous.name, current.name, `Baseline belongs to another package.`)
assert(valid(previous.version), `Invalid baseline version.`)
assert(valid(current.version), `Invalid current version.`)
const releaseIntent = createReleaseIntent(root)
const release = await releaseIntent({
	packageName: current.name,
	packageDirectory: directory,
	currentVersion: current.version,
})
assert.equal(release.status, `release`)
assert(valid(release.version), `Invalid release version.`)
const certified =
	gt(release.version, previous.version) &&
	(await certifyBreaking({
		previousVersion: previous.version,
		release: {
			version: release.version,
			delta: diff(previous.version, release.version) ?? `none`,
		},
		changes: [],
	}))
console.log(
	`${current.name}: ${previous.version} -> ${release.version}; breaking release ${certified ? `certified` : `not certified`}.`,
)
process.exitCode = certified ? 0 : 1
