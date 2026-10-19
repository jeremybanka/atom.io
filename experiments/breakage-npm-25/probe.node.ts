import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { promisify } from "node:util"

const revision = `d5f992ca0b8988367227eb4ea7de59e7ee108497`
const execute = promisify(execFile)
const root = fileURLToPath(new URL(`../../`, import.meta.url))
const toolDirectory = process.argv[2]
assert(
	toolDirectory,
	`Pass a checkout of Breakage PR #25 as the first argument.`,
)
const toolRoot = resolve(toolDirectory)
const actualRevision = await execute(`git`, [`rev-parse`, `HEAD`], {
	cwd: toolRoot,
	encoding: `utf8`,
})
assert.equal(
	actualRevision.stdout.trim(),
	revision,
	`Use the recorded PR #25 revision.`,
)
assert.equal(
	(
		await execute(`git`, [`status`, `--porcelain`, `--untracked-files=no`], {
			cwd: toolRoot,
			encoding: `utf8`,
		})
	).stdout.trim(),
	``,
	`Use an unmodified Breakage checkout.`,
)

// Execute the PR source so a stale dist/ directory cannot affect the probe.
const { npmCheck } = await import(
	pathToFileURL(resolve(toolRoot, `packages/breakage/src/breakage.ts`)).href
)
const packages = [`react`, `solid`, `react-devtools`] as const
const results = []
for (const name of packages) {
	const packageDirectory = resolve(root, `packages`, name)
	const manifest = JSON.parse(
		await readFile(resolve(packageDirectory, `package.json`), `utf8`),
	)
	const report = await npmCheck(
		{
			artifact: `.breakage/npm/package.tgz`,
			representatives: `peer-environments/*`,
			lockfile: `package-lock.json`,
			prepareCommand: `npm ci --ignore-scripts --workspaces=false`,
			suites: {
				"atom.io": {
					files: [`contracts/**/*.test.ts`],
					command: `node --test contracts/*.test.ts`,
				},
			},
			// Isolate manifest validation; this probe makes no release-baseline claim.
			baseline: { firstRelease: true },
		},
		{ baseDirectory: packageDirectory },
	)
	results.push({
		package: manifest.name,
		peers: manifest.peerDependencies,
		exitCode: report.exitCode,
		errors: report.errors,
	})
}

process.stdout.write(
	`${JSON.stringify(
		{
			breakageRevision: revision,
			results,
		},
		null,
		2,
	)}\n`,
)
process.exitCode = Math.max(...results.map((result) => result.exitCode))
