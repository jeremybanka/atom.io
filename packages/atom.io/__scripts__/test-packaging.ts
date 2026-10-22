import { execFileSync } from "node:child_process"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, `..`)
const fixtures = join(packageRoot, `__tests__/fixtures/peer-packages`)
const fixtureRoot = await mkdtemp(join(tmpdir(), `atom-io-peer-packages-`))

function pnpm(cwd: string, ...args: string[]): void {
	execFileSync(`pnpm`, [`--reporter=silent`, ...args], {
		cwd,
		stdio: `inherit`,
		timeout: 180_000,
	})
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, JSON.stringify(value, null, 2))
}

try {
	pnpm(packageRoot, `pack`, `--out`, join(fixtureRoot, `atom.io.tgz`))
	const appRoot = join(fixtureRoot, `core`)
	await mkdir(appRoot, { recursive: true })
	await cp(
		join(fixtures, `pnpm-workspace.yaml`),
		join(appRoot, `pnpm-workspace.yaml`),
	)
	await writeJson(join(appRoot, `package.json`), {
		private: true,
		type: `module`,
		dependencies: { "atom.io": `file:../atom.io.tgz` },
	})
	await cp(join(fixtures, `core-only.ts`), join(appRoot, `core-only.ts`))
	pnpm(appRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
	execFileSync(process.execPath, [join(appRoot, `core-only.ts`)], {
		stdio: `inherit`,
	})
	console.log(`The packed SDK works without framework or realtime peers.`)
} finally {
	await rm(fixtureRoot, { recursive: true, force: true })
}
