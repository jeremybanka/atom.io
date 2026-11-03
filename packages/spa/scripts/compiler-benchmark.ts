import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { compile } from "../src/compiler.ts"

// An optional module exporting compile() lets the same corpus measure a baseline.
const baselinePath = process.argv[2]
const compilers: Record<string, typeof compile> = { oxc: compile }
if (baselinePath)
	compilers[`baseline`] = (
		await import(pathToFileURL(resolve(baselinePath)).href)
	).compile

async function sources(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true })
	return (
		await Promise.all(
			entries.map((entry) => {
				const path = resolve(directory, entry.name)
				if (entry.isDirectory())
					return [`node_modules`, `dist`, `.astro`].includes(entry.name)
						? []
						: sources(path)
				return /\.[jt]sx$/.test(entry.name) ? [path] : []
			}),
		)
	).flat()
}
const corpus = await Promise.all(
	(await sources(resolve(import.meta.dirname, `..`))).map(async (filename) => ({
		filename,
		code: await readFile(filename, `utf8`),
	})),
)
const samples: Record<string, number[]> = {}
for (let iteration = 0; iteration < 10; iteration++) {
	for (const [name, compiler] of Object.entries(compilers)) {
		const start = performance.now()
		for (const { code, filename } of corpus) compiler(code, filename)
		const elapsed = performance.now() - start
		if (iteration >= 3) (samples[name] ??= []).push(elapsed)
	}
}
console.log(
	`Compiler-only benchmark: ${corpus.length} modules, ${corpus.reduce((sum, file) => sum + Buffer.byteLength(file.code), 0)} bytes; median of 7 warm runs, source maps enabled.`,
)
console.table(
	Object.fromEntries(
		Object.entries(samples).map(([name, timings]) => [
			name,
			{ milliseconds: timings.sort((a, b) => a - b)[3] },
		]),
	),
)
