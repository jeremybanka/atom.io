#!/usr/bin/env bun
import path from "node:path"

import {
	deriveVariants,
	manifest,
	prepareCorpus,
	resolveCacheLayout,
	verifySource,
	verifySourceIfPresent,
} from "./large-document-corpus"
import { validateMarkdownEditorCorpus } from "./validate-markdown-editor-corpus"

type Command = `derive` | `prepare` | `test` | `verify`

async function main(): Promise<void> {
	const command = process.argv[2]
	if (!isCommand(command)) throw new Error(usage)
	const options = process.argv.slice(3)
	const cacheRoot = readOption(options, `cache-root`)
	const layout = resolveCacheLayout(cacheRoot)

	switch (command) {
		case `prepare`: {
			const source = readSourceOption(options)
			const result = await prepareCorpus({
				cacheRoot,
				refresh: options.includes(`--refresh`),
				source,
			})
			const status = result.recovered
				? `RECOVERED`
				: result.refreshed
					? `REFRESHED`
					: result.downloaded
						? `PREPARED`
						: `VERIFIED`
			console.log(`${status} ${manifest.corpus.id} at ${result.sourcePath}`)
			console.log(`${result.identity.bytes} bytes / ${result.identity.sha256}`)
			return
		}
		case `verify`: {
			if (process.argv.includes(`--if-present`)) {
				const result = await verifySourceIfPresent(layout.sourcePath)
				if (result.status === `skipped`) {
					console.log(
						`SKIPPED large-document corpus: corpus is intentionally absent at ${layout.sourcePath}.`,
					)
					return
				}
				console.log(
					`VERIFIED ${manifest.corpus.id}: ${result.identity.bytes} bytes / ${result.identity.sha256}`,
				)
				return
			}
			const identity = await verifySource(layout.sourcePath)
			console.log(
				`VERIFIED ${manifest.corpus.id}: ${identity.bytes} bytes / ${identity.sha256}`,
			)
			return
		}
		case `derive`: {
			const report = await deriveVariants({
				cacheRoot,
				enforceManifest: !process.argv.includes(`--record`),
			})
			console.log(JSON.stringify(report, null, `\t`))
			console.log(`DERIVED variants at ${layout.variantsDir}`)
			return
		}
		case `test`: {
			await verifySource(layout.sourcePath)
			const report = await deriveVariants({ cacheRoot })
			const editor = await validateMarkdownEditorCorpus(
				[
					layout.sourcePath,
					manifest.variants.headingRich,
					manifest.variants.veryLongParagraph,
					manifest.variants.fenced,
					manifest.variants.repeated50MiB,
					manifest.variants.unicodeAdversarial,
				].map((variant) =>
					typeof variant === `string`
						? variant
						: path.join(layout.variantsDir, variant.filename),
				),
				{
					stabilizationOperations: 100_001,
					timeoutMsPerDocument: 180_000,
				},
			)
			console.log(JSON.stringify(report, null, `\t`))
			console.log(JSON.stringify({ editor }, null, `\t`))
			console.log(
				`PASSED large-document corpus integrity and derivation checks.`,
			)
			return
		}
	}
}

const usage = `Usage: pnpm corpus:large:prepare [--source=mirror|upstream] [--refresh], pnpm corpus:large:{verify|derive}, or pnpm test:large-document`

function isCommand(value: string | undefined): value is Command {
	return (
		value === `derive` ||
		value === `prepare` ||
		value === `test` ||
		value === `verify`
	)
}

function readSourceOption(args: string[]): `mirror` | `upstream` {
	const source = readOption(args, `source`) ?? `mirror`
	if (source !== `mirror` && source !== `upstream`) {
		throw new Error(`--source must be either "mirror" or "upstream".`)
	}
	return source
}

function readOption(args: string[], name: string): string | undefined {
	const prefix = `--${name}=`
	return args
		.find((argument) => argument.startsWith(prefix))
		?.slice(prefix.length)
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error)
	console.error(`FAILED large-document corpus: ${message}`)
	process.exitCode = 1
})
