import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const packageRoot = resolve(import.meta.dirname, `..`)
const fixtureRoot = await mkdtemp(join(tmpdir(), `devtools-packaging-`))
function pnpm(cwd: string, ...args: string[]): void {
	execFileSync(`pnpm`, [`--reporter=append-only`, ...args], {
		cwd,
		stdio: `inherit`,
		timeout: 180_000,
	})
}

try {
	for (const name of [`atom.io`, `spa`, `react`, `devtools`]) {
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
			"@atom.io/devtools": `file:../devtools.tgz`,
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
				name: `devtools-consumer-${version ?? `spa`}`,
				private: true,
				type: `module`,
				dependencies,
			}),
		)
		pnpm(appRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
		const require = createRequire(join(appRoot, `package.json`))
		if (!version) {
			const help = execFileSync(`pnpm`, [`exec`, `atom-io-devtools`, `--help`], {
				cwd: appRoot,
				encoding: `utf8`,
				timeout: 10_000,
			})
			assert.match(help, /atom-io-devtools <entry>/)
			assert.match(help, /--port/)
			assert.match(help, /--allow-production/)

			const installed = dirname(
				require.resolve(`@atom.io/devtools/package.json`),
			)
			// The exhibit resolves the workspace SDK, distinct from the packed CLI's peer.
			const entry = join(packageRoot, `exhibits/standalone-silo.ts`)
			const startup = spawnSync(
				process.execPath,
				[
					`--import`,
					`data:text/javascript,setInterval(() => {}, 1000)`,
					join(installed, `dist/cli.js`),
					`--port`,
					`0`,
					entry,
				],
				{
					cwd: appRoot,
					encoding: `utf8`,
					env: { ...process.env, NODE_ENV: `production` },
					timeout: 10_000,
				},
			)
			assert.ifError(startup.error)
			assert.equal(startup.status, 1)
			assert.match(startup.stderr, /requires explicit inspection access/)
		}
		const sdk = await realpath(require.resolve(`atom.io/package.json`))
		for (const name of [`spa`, `devtools`, ...(version ? [`react`] : [])]) {
			const peerRequire = createRequire(
				require.resolve(`@atom.io/${name}/package.json`),
			)
			assert.equal(
				await realpath(peerRequire.resolve(`atom.io/package.json`)),
				sdk,
			)
		}
		const spaRequire = createRequire(
			require.resolve(`@atom.io/spa/package.json`),
		)
		const devtoolsRequire = createRequire(
			require.resolve(`@atom.io/devtools/package.json`),
		)
		assert.equal(
			await realpath(spaRequire.resolve(`motion/package.json`)),
			await realpath(devtoolsRequire.resolve(`motion/package.json`)),
		)
		// These are negative probes of the isolated consumer, not imports used by this test.
		// Keep names as data so dependency analysis does not infer a dependency on them.
		const absentSpecifiers = version
			? []
			: [
					`react/package.json`,
					`react-dom/package.json`,
					`@atom.io/react/package.json`,
					`@types/react/package.json`,
				]
		for (const name of absentSpecifiers) {
			assert.throws(() => require.resolve(name), { code: `MODULE_NOT_FOUND` })
		}
		const css = await readFile(require.resolve(`@atom.io/devtools/css`), `utf8`)
		assert.match(css, /debugger-panel\.[\w-]+/)
		assert.match(css, /container:\s*atom-io-devtools\s*\/\s*size\b/)
		assert.match(css, /@container atom-io-devtools/)
		assert.doesNotMatch(css, /@container atom-io-\w+-module-atom-io-devtools/)
		const cssPath = require.resolve(`@atom.io/devtools/css`)
		const brandAssets = [...css.matchAll(/\.\/brand-fallback\/[\w@-]+\.webp/g)]
		assert.ok(brandAssets.length > 0)
		for (const [asset] of brandAssets) {
			const bytes = await readFile(new URL(asset, pathToFileURL(cssPath)))
			assert.equal(bytes.toString(`ascii`, 8, 12), `WEBP`)
		}
		const provenance = JSON.parse(
			await readFile(
				new URL(`./fonts/PROVENANCE.json`, pathToFileURL(cssPath)),
				`utf8`,
			),
		) as {
			license: string
			files: { name: string; weight: number; sha256: string }[]
		}
		assert.equal(provenance.license, `MPL-2.0`)
		assert.deepEqual(
			provenance.files.map((file) => file.weight),
			[200, 400, 500],
		)
		assert.match(
			await readFile(new URL(`./fonts/LICENSE`, pathToFileURL(cssPath)), `utf8`),
			/Mozilla Public License/,
		)
		for (const font of provenance.files) {
			const bytes = await readFile(
				new URL(`./fonts/${font.name}`, pathToFileURL(cssPath)),
			)
			assert.equal(createHash(`sha256`).update(bytes).digest(`hex`), font.sha256)
			assert.ok(css.includes(`./fonts/${font.name}`))
		}
		assert.doesNotMatch(css, /url\(["']?\/(?!\/)/)

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
