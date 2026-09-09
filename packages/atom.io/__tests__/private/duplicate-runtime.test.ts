import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

it(`shares compatible runtimes across physical package copies`, () => {
	const fixture = resolve(__dirname, `duplicate-runtime-fixture.ts`)
	execFileSync(process.execPath, [`--conditions=browser`, fixture], {
		encoding: `utf8`,
	})
}, 30_000)
