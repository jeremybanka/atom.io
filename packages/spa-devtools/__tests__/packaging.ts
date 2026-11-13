import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const packageRoot = resolve(import.meta.dirname, `..`)
const fixtureRoot = await mkdtemp(join(tmpdir(), `spa-devtools-packaging-`))
function pnpm(cwd: string, ...args: string[]): void {
	execFileSync(`pnpm`, [`--reporter=append-only`, ...args], {
		cwd,
		stdio: `inherit`,
		timeout: 180_000,
	})
}

try {
	for (const name of [`atom.io`, `spa`, `react`, `spa-devtools`]) {
		pnpm(
			resolve(packageRoot, `..`, name),
			`pack`,
			`--out`,
			join(fixtureRoot, `${name}.tgz`),
		)
	}
	for (const version of [null, `18`, `19`]) {
		const appRoot = join(fixtureRoot, `consumer-${version ?? `spa`}`)
		const fixture = join(
			packageRoot,
			`__tests__/fixtures`,
			version ? `react-consumer` : `consumer`,
		)
		await cp(fixture, appRoot, { recursive: true })
		await cp(
			join(packageRoot, `peer-environments/coordinated/pnpm-workspace.yaml`),
			join(appRoot, `pnpm-workspace.yaml`),
		)
		const dependencies: Record<string, string> = {
			"atom.io": `file:../atom.io.tgz`,
			"@atom.io/spa": `file:../spa.tgz`,
			"@atom.io/spa-devtools": `file:../spa-devtools.tgz`,
			"@types/node": `26.6.6`,
			"happy-dom": `21.0.4`,
			typescript: `7.0.2`,
		}
		if (version)
			Object.assign(dependencies, {
				"@atom.io/react": `file:../react.tgz`,
				"@types/react": version === `18` ? `18.3.31` : `19.3.0`,
				"@types/react-dom": version === `18` ? `18.3.7` : `19.3.0`,
				react: version === `18` ? `18.3.1` : `19.3.1`,
				"react-dom": version === `18` ? `18.3.1` : `19.3.1`,
			})
		await writeFile(
			join(appRoot, `package.json`),
			JSON.stringify({
				name: `spa-devtools-consumer-${version ?? `spa`}`,
				private: true,
				type: `module`,
				dependencies,
			}),
		)
		pnpm(appRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
		const require = createRequire(join(appRoot, `package.json`))
		const sdk = await realpath(require.resolve(`atom.io/package.json`))
		for (const name of [`spa`, `spa-devtools`, ...(version ? [`react`] : [])]) {
			const peerRequire = createRequire(
				require.resolve(`@atom.io/${name}/package.json`),
			)
			assert.equal(
				await realpath(peerRequire.resolve(`atom.io/package.json`)),
				sdk,
			)
		}
		assert.throws(() => require.resolve(`motion`))
		if (!version) {
			for (const name of [
				`react`,
				`react-dom`,
				`@atom.io/react`,
				`@types/react`,
			]) {
				assert.throws(() => require.resolve(`${name}/package.json`))
			}
		}
		const css = await readFile(
			require.resolve(`@atom.io/spa-devtools/css`),
			`utf8`,
		)
		assert.match(css, /spa-devtools/)
		execFileSync(process.execPath, [join(appRoot, `check.ts`)], {
			cwd: appRoot,
			stdio: `inherit`,
			timeout: 180_000,
		})
	}
	process.stdout.write(
		`Packed SPA without React and React 18/19 consumers retain types, styles, shared SDK identity, SSR and lifecycle behavior.\n`,
	)
} finally {
	await rm(fixtureRoot, { recursive: true, force: true })
}
