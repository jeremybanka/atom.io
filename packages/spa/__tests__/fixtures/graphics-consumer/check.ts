import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const result = spawnSync(
	process.execPath,
	[
		join(dirname(require.resolve(`typescript/package.json`)), `bin/tsc`),
		`-p`,
		fileURLToPath(new URL(`tsconfig.json`, import.meta.url)),
	],
	{ stdio: `inherit` },
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
for (const conditions of [[], [`--conditions=development`]]) {
	const runtime = spawnSync(
		process.execPath,
		[...conditions, fileURLToPath(new URL(`runtime.ts`, import.meta.url))],
		{ stdio: `inherit` },
	)
	if (runtime.error) throw runtime.error
	if (runtime.status !== 0) process.exit(runtime.status ?? 1)
}
