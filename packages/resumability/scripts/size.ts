import { writeFile } from "node:fs/promises"
import { gzipSync } from "node:zlib"

import { build } from "esbuild"

const result = await build({
	stdin: {
		contents: `export * from './dist/client.js'`,
		resolveDir: new URL(`..`, import.meta.url).pathname,
	},
	bundle: true,
	minify: true,
	write: false,
	platform: `browser`,
	format: `esm`,
	target: `es2022`,
	tsconfigRaw: {},
	metafile: true,
})
const code = result.outputFiles[0].text
const size = {
	minified: Buffer.byteLength(code),
	gzip: gzipSync(code, { level: 9 }).length,
}
if (
	Object.values(result.metafile.outputs).some((output) => output.imports.length)
)
	throw new Error(`Browser runtime must have no external dependencies`)
if (size.gzip > 1000)
	throw new Error(`Browser runtime exceeds its 1,000-byte gzip budget`)
console.log(size)
await writeFile(
	new URL(`../dist/size.json`, import.meta.url),
	JSON.stringify(size, null, 2) + `\n`,
)
