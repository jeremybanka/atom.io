import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import * as Solid from "solid-js"

const require = createRequire(import.meta.url)
const solid2 = `onSettled` in Solid
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
	fixture(solid2 ? `tsconfig.json` : `tsconfig.solid1.json`),
])
for (const conditions of [
	[`--conditions=browser`],
	[`--conditions=browser`, `--conditions=development`],
]) {
	run([
		`--test`,
		...conditions,
		fixture(`runtime.ts`),
		...(solid2 ? [fixture(`solid2.ts`)] : []),
	])
}
run([`--test`, fixture(`server.ts`)])
