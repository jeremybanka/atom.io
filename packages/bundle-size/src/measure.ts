import { gzipSync } from "node:zlib"

import { build } from "esbuild"

import type { BundleMeasurement, BundlePlatform } from "./types.ts"

export type MeasureImportsOptions = {
	external?: readonly string[] | undefined
	platform?: BundlePlatform | undefined
	resolveDirectory: string
	target?: string | undefined
}

export async function measureImports(
	imports: readonly string[],
	options: MeasureImportsOptions,
): Promise<BundleMeasurement> {
	if (imports.length === 0) {
		throw new Error(`A bundle-size entry must import at least one module.`)
	}

	const entry = imports
		.map(
			(specifier, index) =>
				`export * as entry${index} from ${JSON.stringify(specifier)}`,
		)
		.join(`\n`)
	const platform = options.platform ?? `neutral`

	const result = await build({
		bundle: true,
		charset: `utf8`,
		external: [
			...(options.external ?? []),
			...(platform === `browser` ? [] : [`node:*`]),
		],
		format: `esm`,
		legalComments: `none`,
		logLevel: `silent`,
		minify: true,
		outdir: `out`,
		platform,
		stdin: {
			contents: entry,
			loader: `js`,
			resolveDir: options.resolveDirectory,
			sourcefile: `bundle-size-entry.js`,
		},
		target: options.target ?? `es2022`,
		treeShaking: true,
		write: false,
	})

	const outputFiles = [...(result.outputFiles ?? [])].sort((left, right) =>
		left.path.localeCompare(right.path),
	)
	const rawBytes = outputFiles.reduce(
		(total, output) => total + output.contents.byteLength,
		0,
	)
	const gzipBytes = outputFiles.reduce(
		(total, output) =>
			total + gzipSync(output.contents, { level: 9 }).byteLength,
		0,
	)

	return { gzipBytes, rawBytes }
}
