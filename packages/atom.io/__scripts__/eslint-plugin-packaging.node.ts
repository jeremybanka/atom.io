import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const coreRoot = resolve(import.meta.dirname, `..`)
const fixtureRoot = await mkdtemp(join(tmpdir(), `atom-io-eslint-packaging-`))

function pnpm(cwd: string, ...args: string[]): void {
	execFileSync(`pnpm`, args, {
		cwd,
		encoding: `utf8`,
		maxBuffer: 10 * 1024 * 1024,
		timeout: 180_000,
	})
}

async function json(path: string, value: unknown): Promise<void> {
	await writeFile(path, JSON.stringify(value, null, 2))
}

try {
	pnpm(coreRoot, `pack`, `--out`, join(fixtureRoot, `core.tgz`))
	const consumers = [
		{ name: `runtime`, tooling: null },
		{ name: `eslint-9`, tooling: { eslint: `9.38.0`, parser: `8.69.0` } },
		{ name: `eslint-10`, tooling: { eslint: `10.10.0`, parser: `8.70.0` } },
	]
	for (const { name, tooling } of consumers) {
		const appRoot = join(fixtureRoot, name)
		await mkdir(appRoot)
		await json(join(appRoot, `package.json`), {
			name,
			private: true,
			type: `module`,
			dependencies: {
				"atom.io": `file:../core.tgz`,
				...(tooling && {
					"@typescript-eslint/parser": tooling.parser,
					"@types/node": `26.5.1`,
					eslint: tooling.eslint,
					typescript: `6.0.3`,
				}),
			},
		})
		// Each consumer has its own dependency graph. Hoisting must not hide missing imports.
		await writeFile(
			join(appRoot, `pnpm-workspace.yaml`),
			[
				`autoInstallPeers: false`,
				`strictPeerDependencies: true`,
				`hoist: false`,
			].join(`\n`),
		)
		console.log(
			`Checking packed atom.io in ${name} without authoring utilities...`,
		)
		pnpm(appRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
		const require = createRequire(join(appRoot, `package.json`))
		const manifestPath = require.resolve(`atom.io/package.json`)
		const manifest = JSON.parse(await readFile(manifestPath, `utf8`))
		assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0)
		assert.equal(Object.keys(manifest.optionalDependencies ?? {}).length, 0)
		const pluginRequire = createRequire(manifestPath)
		for (const dependency of [`@typescript-eslint/utils`, `@eslint/core`]) {
			assert.throws(() => require.resolve(dependency))
			assert.throws(() => pluginRequire.resolve(dependency))
			assert(!manifest.peerDependencies?.[dependency])
		}
		if (tooling) {
			await cp(
				join(import.meta.dirname, `fixtures/eslint-plugin/consumer.ts.txt`),
				join(appRoot, `consumer.ts`),
			)
			await json(join(appRoot, `tsconfig.json`), {
				compilerOptions: {
					target: `ES2023`,
					module: `NodeNext`,
					strict: true,
					noEmit: true,
					skipLibCheck: false,
				},
				include: [`consumer.ts`],
			})
			pnpm(appRoot, `exec`, `tsc`)
			execFileSync(process.execPath, [`consumer.ts`], {
				cwd: appRoot,
				stdio: `inherit`,
			})
		} else {
			for (const dependency of [`eslint`, `@typescript-eslint/parser`]) {
				assert.throws(() => pluginRequire.resolve(dependency))
			}
			execFileSync(
				process.execPath,
				[
					`--input-type=module`,
					`-e`,
					`import { atom, getState } from 'atom.io'; import plugin from 'atom.io/eslint-plugin'; if (getState(atom({ key: 'fixture', default: 42 })) !== 42 || Object.keys(plugin.rules).length !== 4) process.exit(1)`,
				],
				{ cwd: appRoot, stdio: `inherit` },
			)
		}
	}
	console.log(
		`The plugin loads without tooling; ESLint 9 and 10 consumers lint and typecheck without authoring utilities.`,
	)
} finally {
	await rm(fixtureRoot, { recursive: true, force: true })
}
