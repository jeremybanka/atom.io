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
	for (const version of [`core`, `18`, `19`]) {
		const appRoot = join(fixtureRoot, `apps`, version)
		await mkdir(appRoot, { recursive: true })
		await cp(
			join(fixtures, `pnpm-workspace.yaml`),
			join(appRoot, `pnpm-workspace.yaml`),
		)
		const dependencies =
			version === `core`
				? { "atom.io": `file:../../atom.io.tgz` }
				: {
						"atom.io": `file:../../atom.io.tgz`,
						"@types/react": version === `18` ? `18.3.12` : `19.3.0`,
						"@types/react-dom": version === `18` ? `18.3.1` : `19.3.0`,
						react: version === `18` ? `18.3.1` : `19.3.1`,
						"react-dom": version === `18` ? `18.3.1` : `19.3.1`,
						"socket.io-client": `4.8.4`,
						typescript: `7.0.2`,
					}
		await writeJson(join(appRoot, `package.json`), {
			name: `consumer-${version}`,
			private: true,
			type: `module`,
			dependencies,
		})
		for (const file of version === `core` ? [`core-only.ts`] : [`realtime.ts`]) {
			await cp(join(fixtures, file), join(appRoot, file))
		}
	}
	for (const version of [`core`, `18`, `19`]) {
		const appRoot = join(fixtureRoot, `apps`, version)
		pnpm(appRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
		if (version === `core`) {
			execFileSync(process.execPath, [join(appRoot, `core-only.ts`)], {
				stdio: `inherit`,
			})
			continue
		}
		pnpm(
			appRoot,
			`exec`,
			`tsc`,
			`--ignoreConfig`,
			`--skipLibCheck`,
			`--module`,
			`Preserve`,
			`--moduleResolution`,
			`Bundler`,
			`--target`,
			`ES2024`,
			`--strict`,
			`--noEmit`,
			`realtime.ts`,
		)
	}
	console.log(
		`The packed SDK works without framework peers and retains realtime React declarations with React 18 and 19.`,
	)
} finally {
	await rm(fixtureRoot, { recursive: true, force: true })
}
