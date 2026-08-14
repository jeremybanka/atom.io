import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import type { FileHandle } from "node:fs/promises"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// eslint-disable-next-line import/extensions, quotes
import manifestJson from "../test-corpus/large-document/manifest.json" with { type: "json" }

const FIFTY_MEBIBYTES = 50 * 1024 * 1024
const CACHE_ENV = `ATOM_IO_LARGE_DOCUMENT_CACHE`

export type FileIdentity = {
	bytes: number
	sha256: string
}

export type CorpusManifest = {
	schemaVersion: number
	corpus: FileIdentity & {
		author: string
		id: string
		landingUrl: string
		license: {
			note: string
			status: string
		}
		lines: number
		mirrorUrl: string
		provenance: string
		retrievedAt: string
		sourceUrl: string
		title: string
	}
	variants: Record<VariantId, VariantManifest>
}

export type VariantId =
	| `fenced`
	| `headingRich`
	| `repeated50MiB`
	| `unicodeAdversarial`
	| `veryLongParagraph`

export type VariantManifest = FileIdentity & {
	description: string
	filename: string
}

export type VariantReport = {
	corpus: {
		id: string
		sha256: string
	}
	generatedAt: `deterministic`
	variants: Record<VariantId, FileIdentity & { filename: string }>
}

export type CacheLayout = {
	corpusDir: string
	reportPath: string
	sourcePath: string
	variantsDir: string
}

export const manifest = validateManifest(manifestJson)

export function resolveCacheRoot(env = process.env): string {
	const configured = env[CACHE_ENV]?.trim()
	if (configured) return path.resolve(configured)

	return path.join(os.homedir(), `.cache`, `atom.io`, `large-document-corpus`)
}

export function resolveCacheLayout(cacheRoot = resolveCacheRoot()): CacheLayout {
	const corpusDir = path.join(
		cacheRoot,
		`${manifest.corpus.id}-${manifest.corpus.sha256}`,
	)
	const variantsDir = path.join(corpusDir, `variants`)

	return {
		corpusDir,
		reportPath: path.join(variantsDir, `report.json`),
		sourcePath: path.join(corpusDir, `source.txt`),
		variantsDir,
	}
}

export async function inspectFile(filePath: string): Promise<FileIdentity> {
	const hash = createHash(`sha256`)
	let bytes = 0

	for await (const chunk of createReadStream(filePath)) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		bytes += buffer.byteLength
		hash.update(buffer)
	}

	return { bytes, sha256: hash.digest(`hex`) }
}

export async function verifySource(sourcePath: string): Promise<FileIdentity> {
	let actual: FileIdentity
	try {
		actual = await inspectFile(sourcePath)
	} catch (error) {
		if (isMissingFile(error)) {
			throw new Error(
				`Corpus is absent at ${sourcePath}. Run "pnpm corpus:large:prepare" first.`,
				{ cause: error },
			)
		}
		throw error
	}

	assertIdentity(`corpus`, actual, manifest.corpus)
	return actual
}

export async function prepareCorpus(options?: {
	cacheRoot?: string | undefined
	fetchImpl?:
		| ((input: string, init?: RequestInit) => Promise<Response>)
		| undefined
	source?: `mirror` | `upstream`
}): Promise<{
	downloaded: boolean
	identity: FileIdentity
	sourcePath: string
}> {
	const layout = resolveCacheLayout(options?.cacheRoot)
	const source = options?.source ?? `mirror`

	if (await fileExists(layout.sourcePath)) {
		return {
			downloaded: false,
			identity: await verifySource(layout.sourcePath),
			sourcePath: layout.sourcePath,
		}
	}

	await fs.mkdir(layout.corpusDir, { recursive: true })
	const url = resolveCorpusUrl(source)
	const response = await (options?.fetchImpl ?? fetch)(url, {
		redirect: `follow`,
	})
	if (!response.ok) {
		throw new Error(
			`Unable to download ${source} corpus (${response.status} ${response.statusText}) from ${url}. No file was accepted.`,
		)
	}

	const temporaryPath = `${layout.sourcePath}.${process.pid}.tmp`
	let identity: FileIdentity
	try {
		identity = await streamVerifiedDownload(response, temporaryPath)
	} catch (error) {
		await fs.rm(temporaryPath, { force: true })
		const detail = error instanceof Error ? ` ${error.message}` : ``
		throw new Error(
			`Downloaded corpus did not match the pinned manifest.${detail} No file was accepted. If the upstream edition intentionally changed, verify its provenance and update the manifest and first-party release asset together.`,
			{ cause: error },
		)
	}

	try {
		await fs.rename(temporaryPath, layout.sourcePath)
	} catch (error) {
		await fs.rm(temporaryPath, { force: true })
		throw error
	}

	return { downloaded: true, identity, sourcePath: layout.sourcePath }
}

async function streamVerifiedDownload(
	response: Response,
	temporaryPath: string,
): Promise<FileIdentity> {
	if (!response.body) throw new Error(`Download response had no body.`)

	const reader = response.body.getReader()
	const handle = await fs.open(temporaryPath, `wx`)
	const hash = createHash(`sha256`)
	let bytes = 0

	try {
		while (true) {
			const result = await reader.read()
			if (result.done) break

			bytes += result.value.byteLength
			if (bytes > manifest.corpus.bytes) {
				await reader.cancel(`Pinned corpus byte count exceeded.`)
				throw new Error(
					`Download exceeded the pinned ${manifest.corpus.bytes}-byte limit.`,
				)
			}

			hash.update(result.value)
			await writeComplete(handle, result.value)
		}
	} finally {
		await handle.close()
	}

	const identity = { bytes, sha256: hash.digest(`hex`) }
	assertIdentity(`download`, identity, manifest.corpus)
	return identity
}

async function writeComplete(
	handle: FileHandle,
	payload: Uint8Array,
): Promise<void> {
	let offset = 0
	while (offset < payload.byteLength) {
		const { bytesWritten } = await handle.write(
			payload,
			offset,
			payload.byteLength - offset,
		)
		offset += bytesWritten
	}
}

export function resolveCorpusUrl(
	source: `mirror` | `upstream` = `mirror`,
): string {
	return source === `upstream`
		? manifest.corpus.sourceUrl
		: manifest.corpus.mirrorUrl
}

export async function verifySourceIfPresent(
	sourcePath: string,
): Promise<
	{ status: `skipped` } | { identity: FileIdentity; status: `verified` }
> {
	try {
		return { identity: await verifySource(sourcePath), status: `verified` }
	} catch (error) {
		if (isAbsentError(error)) return { status: `skipped` }
		throw error
	}
}

export function isAbsentError(error: unknown): error is Error {
	return (
		error instanceof Error && error.message.startsWith(`Corpus is absent at `)
	)
}

export async function deriveVariants(options?: {
	cacheRoot?: string | undefined
	enforceManifest?: boolean
}): Promise<VariantReport> {
	const layout = resolveCacheLayout(options?.cacheRoot)
	await verifySource(layout.sourcePath)
	const source = await fs.readFile(layout.sourcePath)
	const sourceText = source.toString(`utf8`)
	const temporaryDir = `${layout.variantsDir}.${process.pid}.tmp`
	await fs.rm(temporaryDir, { force: true, recursive: true })
	await fs.mkdir(temporaryDir, { recursive: true })

	try {
		const variants = {
			headingRich: await writeVariant(
				temporaryDir,
				`headingRich`,
				Buffer.from(makeHeadingRich(sourceText)),
			),
			veryLongParagraph: await writeVariant(
				temporaryDir,
				`veryLongParagraph`,
				Buffer.from(makeVeryLongParagraph(sourceText)),
			),
			fenced: await writeVariant(
				temporaryDir,
				`fenced`,
				Buffer.from(makeFenced(sourceText)),
			),
			repeated50MiB: await writeRepeatedVariant(temporaryDir, source),
			unicodeAdversarial: await writeVariant(
				temporaryDir,
				`unicodeAdversarial`,
				Buffer.from(makeUnicodeAdversarial()),
			),
		} satisfies VariantReport[`variants`]

		if (options?.enforceManifest !== false) {
			for (const [id, actual] of Object.entries(variants)) {
				assertIdentity(
					`variant ${id}`,
					actual,
					manifest.variants[id as VariantId],
				)
			}
		}

		const report: VariantReport = {
			corpus: {
				id: manifest.corpus.id,
				sha256: manifest.corpus.sha256,
			},
			generatedAt: `deterministic`,
			variants,
		}
		await fs.writeFile(
			path.join(temporaryDir, `report.json`),
			`${JSON.stringify(report, null, `\t`)}\n`,
		)

		await fs.rm(layout.variantsDir, { force: true, recursive: true })
		await fs.rename(temporaryDir, layout.variantsDir)
		return report
	} catch (error) {
		await fs.rm(temporaryDir, { force: true, recursive: true })
		throw error
	}
}

export function makeHeadingRich(source: string): string {
	let nonEmptyLine = 0
	return source
		.split(`\n`)
		.map((line) => {
			if (line.length === 0) return line
			const output = nonEmptyLine % 64 === 0 ? `## ${line}` : line
			nonEmptyLine += 1
			return output
		})
		.join(`\n`)
}

export function makeVeryLongParagraph(source: string): string {
	return `${source.replace(/\s+/gu, ` `).trim()}\n`
}

export function makeFenced(source: string): string {
	return `\`\`\`text\n${source}${source.endsWith(`\n`) ? `` : `\n`}\`\`\`\n`
}

export function makeUnicodeAdversarial(rows = 8192): string {
	const graphemes = [
		`é`,
		`e\u0301`,
		`👩‍💻`,
		`🏳️‍🌈`,
		`\u2066left-to-right isolate\u2069`,
		`\u2067مرحبا\u2069`,
		`क्‍ष`,
		`中文`,
		`Z̧̢̡̻̮̜̝̦̤̱͑̇͒͛ͮ̾̓ͥͨͣ̐ͯͦ͊ͫ͋̚͠ͅ`,
	]
	let output = `# Unicode and grapheme adversaries\n`
	for (let index = 0; index < rows; index += 1) {
		output += `## Row ${index.toString().padStart(4, `0`)}\n${graphemes.join(` | `)}\n`
	}
	return output
}

function validateManifest(value: unknown): CorpusManifest {
	if (!value || typeof value !== `object`) {
		throw new TypeError(`Large-document corpus manifest must be an object.`)
	}

	const candidate = value as CorpusManifest
	if (
		candidate.schemaVersion !== 1 ||
		!candidate.corpus?.id ||
		!candidate.corpus.sha256 ||
		candidate.corpus.bytes <= 0 ||
		!candidate.corpus.mirrorUrl ||
		!candidate.variants
	) {
		throw new TypeError(`Large-document corpus manifest is incomplete.`)
	}

	return candidate
}

function identityOf(buffer: Uint8Array): FileIdentity {
	return {
		bytes: buffer.byteLength,
		sha256: createHash(`sha256`).update(buffer).digest(`hex`),
	}
}

function assertIdentity(
	label: string,
	actual: FileIdentity,
	expected: FileIdentity,
): void {
	if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
		throw new Error(
			`${label} failed integrity verification: expected ${expected.bytes} bytes / ${expected.sha256}, received ${actual.bytes} bytes / ${actual.sha256}.`,
		)
	}
}

async function writeVariant(
	directory: string,
	id: VariantId,
	payload: Uint8Array,
): Promise<FileIdentity & { filename: string }> {
	const filename = manifest.variants[id].filename
	await fs.writeFile(path.join(directory, filename), payload)
	return { filename, ...identityOf(payload) }
}

async function writeRepeatedVariant(
	directory: string,
	source: Uint8Array,
): Promise<FileIdentity & { filename: string }> {
	const id = `repeated50MiB`
	const filename = manifest.variants[id].filename
	const repeats = Math.ceil(FIFTY_MEBIBYTES / source.byteLength)
	const filePath = path.join(directory, filename)
	const handle = await fs.open(filePath, `wx`)
	const hash = createHash(`sha256`)
	let bytes = 0

	try {
		for (let index = 0; index < repeats; index += 1) {
			await handle.write(source)
			hash.update(source)
			bytes += source.byteLength
		}
	} finally {
		await handle.close()
	}

	return { bytes, filename, sha256: hash.digest(`hex`) }
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch (error) {
		if (isMissingFile(error)) return false
		throw error
	}
}

function isMissingFile(error: unknown): boolean {
	return (
		error instanceof Error &&
		`code` in error &&
		(error as NodeJS.ErrnoException).code === `ENOENT`
	)
}
