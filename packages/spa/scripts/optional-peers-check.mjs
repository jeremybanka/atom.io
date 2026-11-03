import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { build } from "esbuild"

const root = resolve(import.meta.dirname, `..`)
const fixture = await mkdtemp(join(tmpdir(), `spa-no-peers-`))
try {
	const packagePath = join(fixture, `node_modules/@atom.io/spa`)
	await mkdir(packagePath, { recursive: true })
	await cp(join(root, `dist`), join(packagePath, `dist`), { recursive: true })
	await cp(join(root, `package.json`), join(packagePath, `package.json`))
	await symlink(
		join(root, `node_modules/atom.io`),
		join(fixture, `node_modules/atom.io`),
	)
	await writeFile(
		join(fixture, `package.json`),
		JSON.stringify({ type: `module` }),
	)
	await writeFile(
		join(fixture, `app.tsx`),
		`import { render } from '@atom.io/spa'; const app = <custom-panel/>; void render; void app;`,
	)
	await writeFile(
		join(fixture, `tsconfig.json`),
		JSON.stringify({
			compilerOptions: {
				module: `Preserve`,
				moduleResolution: `Bundler`,
				target: `ES2024`,
				strict: true,
				jsx: `react-jsx`,
				jsxImportSource: `@atom.io/spa`,
				skipLibCheck: false,
				noEmit: true,
				types: [],
				lib: [`DOM`, `ESNext`],
			},
			files: [`app.tsx`],
		}),
	)
	const run = (args) => {
		const result = spawnSync(process.execPath, args, {
			cwd: fixture,
			stdio: `inherit`,
		})
		if (result.error) throw result.error
		assert.equal(result.status, 0)
	}
	const require = createRequire(import.meta.url)
	run([
		join(dirname(require.resolve(`typescript/package.json`)), `bin/tsc`),
		`-p`,
		join(fixture, `tsconfig.json`),
	])
	for (const conditions of [[], [`--conditions=development`]])
		run([
			...conditions,
			`--input-type=module`,
			`-e`,
			`await import('@atom.io/spa'); await import('@atom.io/spa/jsx-runtime'); await import('@atom.io/spa/server');`,
		])

	for (const entry of [`index`, `konva`, `three`, `motion`]) {
		const output = await build({
			stdin: {
				contents: `export * from './dist/${entry}.js'`,
				resolveDir: root,
			},
			bundle: true,
			write: false,
			metafile: true,
			platform: `browser`,
			format: `esm`,
		})
		const inputs = Object.keys(output.metafile.inputs)
		const forbidden =
			entry === `index`
				? [`motion`, `framer-motion`, `konva`, `three`, `react`, `react-dom`]
				: entry === `motion`
					? [`konva`, `three`, `react`, `react-dom`]
					: [
							entry === `three` ? `konva` : `three`,
							`motion`,
							`framer-motion`,
							`react`,
							`react-dom`,
						]
		for (const peer of forbidden)
			assert.ok(
				!inputs.some((input) => input.includes(`/node_modules/${peer}/`)),
				`${entry} imports unwanted peer ${peer}`,
			)
	}
	console.log(
		`Base runtime and declarations work without optional peers; integration bundles remain isolated.`,
	)
} finally {
	await rm(fixture, { recursive: true, force: true })
}
