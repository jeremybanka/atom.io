import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { getPackages } from "@manypkg/get-packages"

const root = process.cwd()
const { packages } = await getPackages(root)
const combined: Record<string, unknown> = {}
for (const pkg of packages) {
	if (!pkg.packageJson.scripts?.[`cov`]) continue
	const filename = path.join(pkg.dir, `coverage/coverage-final.json`)
	const coverage = JSON.parse(await readFile(filename, `utf8`)) as Record<
		string,
		{ path: string }
	>
	assert(
		Object.keys(coverage).length > 0,
		`Empty coverage report: ${pkg.packageJson.name}.`,
	)
	for (const [source, report] of Object.entries(coverage)) {
		// Turbo can restore a report produced in another checkout or on another runner.
		const marker = `/${path.relative(root, pkg.dir).split(path.sep).join(`/`)}/src/`
		const start = source.replaceAll(`\\`, `/`).lastIndexOf(marker)
		assert(start >= 0, `Coverage escapes its owning package: ${source}.`)
		const canonical = path.join(
			root,
			source.replaceAll(`\\`, `/`).slice(start + 1),
		)
		assert(
			!Object.hasOwn(combined, canonical),
			`Multiple packages report ownership of ${source}.`,
		)
		combined[canonical] = { ...report, path: canonical }
	}
}
assert(Object.keys(combined).length > 0, `No package coverage reports found.`)
await mkdir(`coverage`, { recursive: true })
await writeFile(`coverage/coverage-final.json`, JSON.stringify(combined))
console.log(
	`Combined ${Object.keys(combined).length} source reports from package-owned coverage suites.`,
)
