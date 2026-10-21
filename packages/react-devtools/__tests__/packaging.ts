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
const fixtures = join(packageRoot, `__tests__/fixtures/consumer`)
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
	for (const name of [`atom.io`, `react`, `react-devtools`]) {
		pnpm(
			resolve(packageRoot, `..`, name),
			`pack`,
			`--out`,
			join(fixtureRoot, `${name}.tgz`),
		)
	}
	for (const version of [`18`, `19`]) {
		const appRoot = join(fixtureRoot, `apps`, version)
		await mkdir(appRoot, { recursive: true })
		await cp(
			join(fixtures, `../pnpm-workspace.yaml`),
			join(appRoot, `pnpm-workspace.yaml`),
		)
		const dependencies = {
			"atom.io": `file:../../atom.io.tgz`,
			"@atom.io/react": `file:../../react.tgz`,
			"@atom.io/react-devtools": `file:../../react-devtools.tgz`,
			"@types/node": `26.6.5`,
			"@types/react": version === `18` ? `18.3.12` : `19.3.0`,
			"@types/react-dom": version === `18` ? `18.3.1` : `19.3.0`,
			react: version === `18` ? `18.3.1` : `19.3.1`,
			"react-dom": version === `18` ? `18.3.1` : `19.3.1`,
			typescript: `7.0.2`,
		}
		await writeJson(join(appRoot, `package.json`), {
			name: `consumer-${version}`,
			private: true,
			type: `module`,
			dependencies,
		})
		for (const file of [`types.ts`, `runtime.ts`, `tsconfig.json`]) {
			await cp(join(fixtures, file), join(appRoot, file))
		}
	}
	for (const version of [`18`, `19`]) {
		const appRoot = join(fixtureRoot, `apps`, version)
		pnpm(appRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
		const require = createRequire(join(appRoot, `package.json`))
		const sdk = await realpath(require.resolve(`atom.io/package.json`))
		for (const name of [`react`, `react-devtools`]) {
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
		assert.equal(devtools.dependencies.motion, `14.4.0`)
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
		execFileSync(process.execPath, [join(appRoot, `runtime.ts`)], {
			stdio: `inherit`,
		})
	}
	process.stdout.write(
		`Packed devtools retain types, styles, Motion and shared SDK identity with React 18 and 19, without hoisting.\n`,
	)
} finally {
	await rm(fixtureRoot, { recursive: true, force: true })
}
