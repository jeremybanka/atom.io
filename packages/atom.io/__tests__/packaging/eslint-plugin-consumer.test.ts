import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterAll, beforeAll, it } from "vitest"

const coreRoot = resolve(import.meta.dirname, `../..`)
const fixtures = join(import.meta.dirname, `fixtures/eslint-plugin`)
let fixtureRoot = ``

function pnpm(cwd: string, ...args: string[]): void {
	execFileSync(`pnpm`, [`--reporter=silent`, ...args], {
		cwd,
		stdio: `inherit`,
		timeout: 180_000,
	})
}

beforeAll(async () => {
	fixtureRoot = await mkdtemp(join(tmpdir(), `atom-io-eslint-packaging-`))
	pnpm(coreRoot, `pack`, `--out`, join(fixtureRoot, `core.tgz`))
})

afterAll(async () => {
	if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true })
})

it.each([
	{ name: `runtime`, tooling: null },
	{ name: `eslint-9`, tooling: { eslint: `9.38.0`, parser: `8.69.0` } },
	{ name: `eslint-10`, tooling: { eslint: `10.10.0`, parser: `8.70.0` } },
])(`packed consumer: $name`, async ({ name, tooling }) => {
	const appRoot = join(fixtureRoot, name)
	await mkdir(appRoot)
	await writeFile(
		join(appRoot, `package.json`),
		JSON.stringify({
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
		}),
	)
	// Each consumer has its own dependency graph; hoisting cannot hide missing imports.
	for (const file of [`pnpm-workspace.yaml`, `tsconfig.json`]) {
		await cp(join(fixtures, file), join(appRoot, file))
	}
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
		await cp(join(fixtures, `consumer.ts`), join(appRoot, `consumer.ts`))
		pnpm(appRoot, `exec`, `tsc`)
		execFileSync(process.execPath, [`consumer.ts`], {
			cwd: appRoot,
			stdio: `inherit`,
		})
		// A rule author chooses RuleTester; ordinary plugin consumers above do not.
		pnpm(
			appRoot,
			`add`,
			`--ignore-scripts`,
			`-D`,
			`@typescript-eslint/rule-tester@${tooling.parser}`,
		)
		await cp(join(fixtures, `rule-tester.ts`), join(appRoot, `rule-tester.ts`))
		pnpm(appRoot, `exec`, `tsc`)
	} else {
		for (const dependency of [`eslint`, `@typescript-eslint/parser`]) {
			assert.throws(() => pluginRequire.resolve(dependency))
		}
		await cp(join(fixtures, `runtime.ts`), join(appRoot, `runtime.ts`))
		execFileSync(process.execPath, [`runtime.ts`], {
			cwd: appRoot,
			stdio: `inherit`,
		})
	}
})
