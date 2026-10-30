import { copyFile, rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "esbuild"

const root = resolve(import.meta.dirname, `..`)
await rm(resolve(root, `dist`), { recursive: true, force: true })
await build({
	absWorkingDir: root,
	entryPoints: [
		`src/index.ts`,
		`src/client.ts`,
		`src/server.ts`,
		`src/astro.ts`,
	],
	outdir: `dist`,
	bundle: true,
	splitting: true,
	format: `esm`,
	platform: `neutral`,
	target: `es2022`,
	packages: `external`,
	sourcemap: true,
	tsconfigRaw: {},
})
await copyFile(
	resolve(root, `src/Resumption.astro`),
	resolve(root, `dist/Resumption.astro`),
)
