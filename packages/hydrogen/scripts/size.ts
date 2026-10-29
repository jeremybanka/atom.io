import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { brotliCompressSync, gunzipSync, gzipSync } from "node:zlib"

import { gzipAsync } from "@gfx/zopfli"
import { build } from "esbuild"
import { minify } from "rolldown/utils"

const root = resolve(import.meta.dirname, `..`)
async function measure(name: string, entry: string, external: string[] = []) {
	const result = await build({
		absWorkingDir: root,
		stdin: { contents: entry, resolveDir: root, loader: `js` },
		bundle: true,
		write: false,
		format: `esm`,
		platform: `browser`,
		target: `es2022`,
		tsconfigRaw: {},
		external,
		logLevel: `silent`,
		minify: false,
	})
	const raw = result.outputFiles[0].text
	const minified = (
		await minify(`${name}.js`, raw, {
			module: true,
			compress: { target: `es2022` },
			mangle: true,
		})
	).code
	const optimized = await gzipAsync(minified, { numiterations: 50 })
	if (gunzipSync(optimized).toString() !== minified)
		throw new Error(`gzip round trip failed`)
	if (name === `hydrogen client`) {
		await writeFile(resolve(root, `dist/client.min.js`), minified)
		await writeFile(resolve(root, `dist/client.min.js.gz`), optimized)
		await writeFile(
			resolve(root, `dist/client.min.js.br`),
			brotliCompressSync(minified),
		)
		await writeFile(
			resolve(root, `dist/client.min.d.ts`),
			`export * from './index.js'; export * from './jsx-runtime.js'\n`,
		)
	}
	return {
		name,
		raw: Buffer.byteLength(raw),
		minified: Buffer.byteLength(minified),
		gzip: gzipSync(minified, { level: 9 }).length,
		optimizedGzip: optimized.length,
		brotli: brotliCompressSync(minified).length,
	}
}
const hydrogen = await measure(
	`hydrogen client`,
	`export * from './dist/index.js'; export * from './dist/jsx-runtime.js'`,
	[`atom.io`, `atom.io/*`],
)
const results = [
	hydrogen,
	await measure(
		`hydrogen + atom.io`,
		`export * from './dist/index.js'; export * from './dist/jsx-runtime.js'`,
	),
	await measure(
		`hydrogen Astro client`,
		`export {default} from './dist/astro-client.js'`,
		[`atom.io`, `atom.io/*`],
	),
	await measure(`Preact`, `export * from 'preact'`),
]
console.table(results)
await writeFile(
	resolve(root, `dist/size.json`),
	JSON.stringify(results, null, 2) + `\n`,
)
if (hydrogen.optimizedGzip >= 3000)
	throw new Error(
		`hydrogen exceeds the 3,000-byte gzip budget: ${hydrogen.optimizedGzip}`,
	)
