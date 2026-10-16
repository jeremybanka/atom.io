import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

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
	for (const name of [`atom.io`, `react`, `solid`, `react-devtools`]) {
		pnpm(
			resolve(packageRoot, `..`, name),
			`pack`,
			`--out`,
			join(fixtureRoot, `${name}.tgz`),
		)
	}
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
						"@atom.io/react": `file:../../react.tgz`,
						"@atom.io/solid": `file:../../solid.tgz`,
						"@atom.io/react-devtools": `file:../../react-devtools.tgz`,
						"@types/react": version === `18` ? `18.3.12` : `19.3.0`,
						"@types/react-dom": version === `18` ? `18.3.1` : `19.3.0`,
						react: version === `18` ? `18.3.1` : `19.3.1`,
						"react-dom": version === `18` ? `18.3.1` : `19.3.1`,
						"solid-js": `1.9.17`,
						"socket.io-client": `4.8.4`,
						typescript: `7.0.2`,
					}
		await writeJson(join(appRoot, `package.json`), {
			name: `consumer-${version}`,
			private: true,
			type: `module`,
			dependencies,
		})
		for (const file of version === `core`
			? [`core-only.ts`]
			: [`consumer.ts`, `runtime.ts`, `realtime.ts`, `tsconfig.json`]) {
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
		const require = createRequire(join(appRoot, `package.json`))
		const sdk = await realpath(require.resolve(`atom.io/package.json`))
		for (const name of [`react`, `solid`, `react-devtools`]) {
			const adapterRequire = createRequire(
				require.resolve(`@atom.io/${name}/package.json`),
			)
			assert.equal(
				await realpath(adapterRequire.resolve(`atom.io/package.json`)),
				sdk,
			)
		}
		const devtoolsManifest = require.resolve(
			`@atom.io/react-devtools/package.json`,
		)
		const devtools = JSON.parse(await readFile(devtoolsManifest, `utf8`))
		assert.equal(devtools.dependencies.motion, `14.3.0`)
		assert(
			(
				await readFile(
					join(dirname(devtoolsManifest), devtools.exports[`./css`].import),
					`utf8`,
				)
			).length > 0,
		)
		assert.throws(() => require.resolve(`motion`))
		pnpm(appRoot, `exec`, `tsc`)
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
		execFileSync(process.execPath, [join(appRoot, `runtime.ts`)], {
			stdio: `inherit`,
		})
	}
	console.log(
		`Packed integrations retain types, styles and shared SDK identity with React 18 and 19, without hoisting.`,
	)
} finally {
	await rm(fixtureRoot, { recursive: true, force: true })
}
