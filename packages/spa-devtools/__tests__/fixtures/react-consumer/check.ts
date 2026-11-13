import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const fixture = (name: string): string =>
	fileURLToPath(new URL(name, import.meta.url))
function run(args: string[]): void {
	const result = spawnSync(process.execPath, args, { stdio: `inherit` })
	if (result.error) throw result.error
	if (result.status !== 0) process.exit(result.status ?? 1)
}
run([
	join(dirname(require.resolve(`typescript/package.json`)), `bin/tsc`),
	`-p`,
	fixture(`tsconfig.json`),
])
for (const conditions of [[], [`--conditions=development`]])
	run([...conditions, `--test`, fixture(`runtime.ts`)])
