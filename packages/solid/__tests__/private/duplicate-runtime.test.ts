import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

it(`shares compatible solid runtimes across physical package copies`, () => {
	execFileSync(
		process.execPath,
		[
			`--conditions=browser`,
			resolve(__dirname, `../fixtures/duplicate-runtime.ts`),
		],
		{ encoding: `utf8` },
	)
}, 30_000)
