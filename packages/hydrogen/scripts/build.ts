import { copyFile, rm } from "node:fs/promises"
import { resolve } from "node:path"

import { build } from "esbuild"

const root = resolve(import.meta.dirname, `..`)
await rm(resolve(root, `dist`), { recursive: true, force: true })
for (const development of [false, true]) {
	await build({
		absWorkingDir: root,
		entryPoints: [
			`src/index.ts`,
			`src/jsx-runtime.ts`,
			`src/server.ts`,
			`src/vite.ts`,
			`src/astro.ts`,
			`src/astro-client.ts`,
			`src/astro-server.ts`,
		],
		outdir: development ? `dist/development` : `dist`,
		bundle: true,
		splitting: true,
		format: `esm`,
		platform: `neutral`,
		target: `es2022`,
		packages: `external`,
		tsconfigRaw: {},
		mangleProps: /^_/,
		sourcemap: true,
		define: { "import.meta.env.DEV": String(development) },
	})
}

await copyFile(
	resolve(root, `src/jsx-types.d.ts`),
	resolve(root, `dist/jsx-types.d.ts`),
)
