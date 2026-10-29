import { copyFile, readFile, rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "esbuild"

import { compile } from "../../water/src/compiler.ts"

const root = resolve(import.meta.dirname, `..`)
await rm(resolve(root, `dist`), { recursive: true, force: true })
await build({
	absWorkingDir: root,
	entryPoints: [`src/index.ts`],
	outdir: `dist`,
	bundle: true,
	format: `esm`,
	platform: `neutral`,
	target: `es2022`,
	packages: `external`,
	tsconfigRaw: {},
	sourcemap: true,
	plugins: [
		{
			name: `water`,
			setup(builder) {
				builder.onLoad({ filter: /\.tsx$/ }, async ({ path }) => ({
					contents: compile(await readFile(path, `utf8`), path).code,
					loader: `ts`,
				}))
			},
		},
	],
})
await copyFile(
	resolve(root, `src/devtools.css`),
	resolve(root, `dist/devtools.css`),
)

await copyFile(resolve(root, `src/css.d.ts`), resolve(root, `dist/css.d.ts`))
