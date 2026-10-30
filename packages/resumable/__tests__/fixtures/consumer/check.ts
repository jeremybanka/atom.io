import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
for (const args of [
	[
		join(dirname(require.resolve(`typescript/package.json`)), `bin/tsc`),
		`-p`,
		fileURLToPath(new URL(`tsconfig.json`, import.meta.url)),
	],
	[
		join(dirname(require.resolve(`typescript/package.json`)), `bin/tsc`),
		`-p`,
		fileURLToPath(new URL(`tsconfig.tools.json`, import.meta.url)),
	],
	[fileURLToPath(new URL(`runtime.ts`, import.meta.url))],
]) {
	const result = spawnSync(process.execPath, args, { stdio: `inherit` })
	if (result.error) throw result.error
	if (result.status !== 0) process.exit(result.status ?? 1)
}
