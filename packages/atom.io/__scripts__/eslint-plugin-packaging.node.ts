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
import { join, resolve } from "node:path"

const coreRoot = resolve(import.meta.dirname, `..`)
const pluginRoot = resolve(coreRoot, `../eslint-plugin`)
const fixtureRoot = await mkdtemp(join(tmpdir(), `atom-io-eslint-packaging-`))

function pnpm(cwd: string, ...args: string[]): string {
	return execFileSync(`pnpm`, args, {
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
	const artifacts = join(fixtureRoot, `artifacts`)
	await mkdir(artifacts)
	pnpm(coreRoot, `pack`, `--out`, join(artifacts, `core.tgz`))
	pnpm(pluginRoot, `pack`, `--out`, join(artifacts, `plugin.tgz`))
	await json(join(fixtureRoot, `package.json`), { private: true })
	await writeFile(
		join(fixtureRoot, `pnpm-workspace.yaml`),
		[
			`packages: [apps/*]`,
			`autoInstallPeers: false`,
			`strictPeerDependencies: true`,
			`resolvePeersFromWorkspaceRoot: false`,
			`dedupePeerDependents: false`,
		].join(`\n`),
	)

	// Real parser releases must create different plugin contexts, but one runtime.
	const consumers = [
		{ name: `runtime`, parser: null },
		{ name: `parser-a`, parser: `8.69.0` },
		{ name: `parser-b`, parser: `8.70.0` },
	]
	for (const { name, parser } of consumers) {
		const appRoot = join(fixtureRoot, `apps`, name)
		await mkdir(appRoot, { recursive: true })
		await json(join(appRoot, `package.json`), {
			name,
			private: true,
			type: `module`,
			dependencies: {
				"atom.io": `file:../../artifacts/core.tgz`,
				...(parser && {
					"@atom.io/eslint-plugin": `file:../../artifacts/plugin.tgz`,
					"@typescript-eslint/parser": parser,
					"@types/node": `26.5.0`,
					eslint: `10.10.0`,
					typescript: `6.0.3`,
				}),
			},
		})
		if (parser) {
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
		} else {
			console.log(
				`Checking core and the compatibility export without any tooling installed...`,
			)
			pnpm(fixtureRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
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

	console.log(`Installing packed packages with two parser resolutions...`)
	pnpm(fixtureRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
	const runtimePaths: string[] = []
	const pluginPaths: string[] = []
	const parserPaths: string[] = []
	for (const { name, parser } of consumers) {
		const appRoot = join(fixtureRoot, `apps`, name)
		const require = createRequire(join(appRoot, `package.json`))
		runtimePaths.push(await realpath(require.resolve(`atom.io/package.json`)))
		const manifest = JSON.parse(
			await readFile(require.resolve(`atom.io/package.json`), `utf8`),
		)
		for (const field of [
			`dependencies`,
			`optionalDependencies`,
			`peerDependencies`,
			`peerDependenciesMeta`,
		]) {
			assert(
				!Object.keys(manifest[field] ?? {}).some(
					(key) =>
						key === `eslint` ||
						key.startsWith(`@typescript-eslint/`) ||
						key === `@atom.io/eslint-plugin`,
				),
			)
		}
		assert.throws(() => require.resolve(`@typescript-eslint/utils`))
		if (parser) {
			pluginPaths.push(
				await realpath(require.resolve(`@atom.io/eslint-plugin/package.json`)),
			)
			parserPaths.push(
				await realpath(require.resolve(`@typescript-eslint/parser`)),
			)
			pnpm(appRoot, `exec`, `tsc`)
			execFileSync(process.execPath, [`consumer.ts`], {
				cwd: appRoot,
				stdio: `inherit`,
			})
		} else {
			for (const dependency of [
				`eslint`,
				`@typescript-eslint/parser`,
				`@atom.io/eslint-plugin`,
			]) {
				assert.throws(() => require.resolve(`${dependency}/package.json`))
			}
		}
	}
	assert.equal(new Set(parserPaths).size, 2)
	assert.equal(new Set(pluginPaths).size, 2)
	assert.equal(new Set(runtimePaths).size, 1)
	console.log(
		`Two parser/plugin installations share one physical core runtime; both plugin exports lint and typecheck without a direct utils dependency.`,
	)
} finally {
	await rm(fixtureRoot, { recursive: true, force: true })
}
