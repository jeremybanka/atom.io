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

import { afterAll, beforeAll, it } from "vitest"

const packageRoot = resolve(import.meta.dirname, `..`)
const fixtures = join(import.meta.dirname, `fixtures`)
let consumerRoot = ``

function pnpm(cwd: string, ...args: string[]): void {
	execFileSync(`pnpm`, [`--reporter=silent`, ...args], {
		cwd,
		stdio: `inherit`,
		timeout: 180_000,
	})
}

beforeAll(async () => {
	consumerRoot = await mkdtemp(join(tmpdir(), `atom-io-eslint-consumers-`))
	pnpm(packageRoot, `pack`, `--out`, join(consumerRoot, `plugin.tgz`))
	pnpm(
		resolve(packageRoot, `../atom.io`),
		`pack`,
		`--out`,
		join(consumerRoot, `sdk.tgz`),
	)
})

afterAll(async () => {
	if (consumerRoot) await rm(consumerRoot, { recursive: true, force: true })
})

it.each([
	[`9.38.0`, `6`],
	[`10.12.0`, `6`],
	[`10.12.0`, `7`],
])(
	`packed plugin works with ESLint %s and TypeScript %s`,
	async (eslint, compiler) => {
		const appRoot = join(consumerRoot, `${eslint}-${compiler}`)
		await mkdir(appRoot)
		await writeFile(
			join(appRoot, `package.json`),
			JSON.stringify({
				private: true,
				type: `module`,
				dependencies: {
					"@atom.io/eslint-plugin": `file:../plugin.tgz`,
					"@typescript-eslint/parser": `8.71.2`,
					eslint,
					...(compiler === `7`
						? {
								"@typescript/native": `npm:typescript@7.0.2`,
								typescript: `npm:@typescript/typescript6@6.0.2`,
							}
						: { typescript: `6.0.3` }),
				},
			}),
		)
		for (const file of [`pnpm-workspace.yaml`, `tsconfig.json`, `consumer.ts`]) {
			await cp(join(fixtures, file), join(appRoot, file))
		}
		pnpm(appRoot, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
		const require = createRequire(join(appRoot, `package.json`))
		const manifestPath = require.resolve(`@atom.io/eslint-plugin/package.json`)
		const manifest = JSON.parse(await readFile(manifestPath, `utf8`))
		const pluginRequire = createRequire(manifestPath)
		// The build compiler can be native while ESLint keeps the TypeScript 6 API.
		assert.match(require(`typescript`).version, /^6\./)
		const compilerVersion = execFileSync(`pnpm`, [`exec`, `tsc`, `--version`], {
			cwd: appRoot,
			encoding: `utf8`,
		})
		assert(compilerVersion.trim().startsWith(`Version ${compiler}.`))
		// Utilities belong to the plugin; consumers do not install or hoist them.
		assert.throws(() => require.resolve(`@typescript-eslint/utils`))
		assert(pluginRequire.resolve(`@typescript-eslint/utils`))
		assert.throws(() => pluginRequire.resolve(`atom.io`))
		pnpm(appRoot, `exec`, `tsc`)
		if (compiler === `7`) pnpm(appRoot, `exec`, `tsc6`)
		execFileSync(process.execPath, [`consumer.ts`], {
			cwd: appRoot,
			stdio: `inherit`,
		})
		// Rule authors use the matching typescript-eslint release, without casts.
		pnpm(
			appRoot,
			`add`,
			`--ignore-scripts`,
			`-D`,
			`@typescript-eslint/rule-tester@${manifest.dependencies[`@typescript-eslint/utils`]}`,
		)
		await cp(join(fixtures, `rule-tester.ts`), join(appRoot, `rule-tester.ts`))
		pnpm(appRoot, `exec`, `tsc`)
	},
	180_000,
)

it(`different parser peers share one physical SDK`, async () => {
	const workspace = join(consumerRoot, `workspace`)
	await mkdir(workspace)
	await cp(
		join(fixtures, `pnpm-workspace.yaml`),
		join(workspace, `pnpm-workspace.yaml`),
	)
	await writeFile(
		join(workspace, `package.json`),
		JSON.stringify({ private: true }),
	)
	const consumers: ReturnType<typeof createRequire>[] = []
	for (const parser of [`8.69.0`, `8.71.2`]) {
		const appRoot = join(workspace, `packages`, parser)
		await mkdir(appRoot, { recursive: true })
		await writeFile(
			join(appRoot, `package.json`),
			JSON.stringify({
				name: `parser-${parser}`,
				private: true,
				dependencies: {
					"atom.io": `file:../../../sdk.tgz`,
					"@atom.io/eslint-plugin": `file:../../../plugin.tgz`,
					"@typescript-eslint/parser": parser,
					eslint: `9.38.0`,
					typescript: `6.0.3`,
				},
			}),
		)
		consumers.push(createRequire(join(appRoot, `package.json`)))
	}
	pnpm(workspace, `install`, `--ignore-scripts`, `--no-frozen-lockfile`)
	const [first, second] = consumers
	const sdk = first.resolve(`atom.io/package.json`)
	assert.equal(
		await realpath(sdk),
		await realpath(second.resolve(`atom.io/package.json`)),
	)
	assert.notEqual(
		await realpath(first.resolve(`@typescript-eslint/parser/package.json`)),
		await realpath(second.resolve(`@typescript-eslint/parser/package.json`)),
	)
	assert.notEqual(
		await realpath(first.resolve(`@atom.io/eslint-plugin/package.json`)),
		await realpath(second.resolve(`@atom.io/eslint-plugin/package.json`)),
	)
	const manifest = JSON.parse(await readFile(sdk, `utf8`))
	assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0)
	assert.equal(manifest.peerDependencies.eslint, undefined)
	assert.equal(manifest.peerDependencies[`@typescript-eslint/parser`], undefined)
	assert.throws(() => first.resolve(`atom.io/eslint-plugin`))
}, 180_000)
