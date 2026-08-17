import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// eslint-disable-next-line import/extensions, quotes
import manifestJson from "../test-corpus/large-document/manifest.json" with { type: "json" }

const FIFTY_MEBIBYTES = 50 * 1024 * 1024
const CACHE_ENV = `ATOM_IO_LARGE_DOCUMENT_CACHE`

export const VARIANT_IDS = [
	`fenced`,
	`headingRich`,
	`repeated50MiB`,
	`unicodeAdversarial`,
	`veryLongParagraph`,
] as const

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
		mirrorPublishedAt: string
		mirrorReleaseUrl: string
		mirrorUrl: string
		provenance: string
		retrievedAt: string
		sourceUrl: string
		title: string
	}
	variants: Record<VariantId, VariantManifest>
}

export type VariantId = (typeof VARIANT_IDS)[number]

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

export function resolveCacheRoot(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
	homeDirectory = os.homedir(),
): string {
	const configured = env[CACHE_ENV]?.trim()
	if (configured) return path.resolve(configured)

	if (platform === `darwin`) {
		return path.join(
			homeDirectory,
			`Library`,
			`Caches`,
			`atom.io`,
			`large-document-corpus`,
		)
	}
	if (platform === `win32`) {
		return path.join(
			env[`LOCALAPPDATA`] ?? path.join(homeDirectory, `AppData`, `Local`),
			`atom.io`,
			`large-document-corpus`,
		)
	}

	return path.join(
		env[`XDG_CACHE_HOME`] ?? path.join(homeDirectory, `.cache`),
		`atom.io`,
		`large-document-corpus`,
	)
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
	refresh?: boolean | undefined
	source?: `mirror` | `upstream`
}): Promise<{
	downloaded: boolean
	identity: FileIdentity
	recovered: boolean
	refreshed: boolean
	sourcePath: string
}> {
	const layout = resolveCacheLayout(options?.cacheRoot)
	const source = options?.source ?? `mirror`
	let cachedFileExists = false
	let recovered = false

	if (await fileExists(layout.sourcePath)) {
		cachedFileExists = true
		try {
			const identity = await verifySource(layout.sourcePath)
			if (!options?.refresh) {
				return {
					downloaded: false,
					identity,
					recovered: false,
					refreshed: false,
					sourcePath: layout.sourcePath,
				}
			}
		} catch (error) {
			if (!(error instanceof CorpusIntegrityError)) throw error
			recovered = true
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

	const temporaryPath = `${layout.sourcePath}.${process.pid}.${randomUUID()}.tmp`
	let identity: FileIdentity
	try {
		identity = await streamVerifiedDownload(response, temporaryPath)
	} catch (error) {
		await fs.rm(temporaryPath, { force: true })
		const detail = error instanceof Error ? ` ${error.message}` : ``
		throw new Error(
			`Downloaded corpus did not match the pinned manifest.${detail} No file was accepted. The previous cache entry, if any, was left in place. If the upstream edition intentionally changed, verify its provenance and publish the replacement first-party asset before updating the manifest.`,
			{ cause: error },
		)
	}

	try {
		await replaceFile(temporaryPath, layout.sourcePath)
	} catch (error) {
		await fs.rm(temporaryPath, { force: true })
		throw error
	}

	return {
		downloaded: true,
		identity,
		recovered,
		refreshed: cachedFileExists && !recovered,
		sourcePath: layout.sourcePath,
	}
}

async function streamVerifiedDownload(
	response: Response,
	temporaryPath: string,
): Promise<FileIdentity> {
	if (!response.body) throw new Error(`Download response had no body.`)

	const reader = response.body.getReader()
	let handle: Awaited<ReturnType<typeof fs.open>> | undefined
	const hash = createHash(`sha256`)
	let bytes = 0
	let consumed = false

	try {
		handle = await fs.open(temporaryPath, `wx`)
		while (true) {
			const result = await reader.read()
			if (result.done) {
				consumed = true
				break
			}

			bytes += result.value.byteLength
			if (bytes > manifest.corpus.bytes) {
				throw new Error(
					`Download exceeded the pinned ${manifest.corpus.bytes}-byte limit.`,
				)
			}

			hash.update(result.value)
			await writeComplete(handle, result.value)
		}
	} finally {
		if (!consumed) {
			await reader.cancel(`Corpus download did not complete.`).catch(() => {})
		}
		reader.releaseLock()
		await handle?.close()
	}

	const identity = { bytes, sha256: hash.digest(`hex`) }
	assertIdentity(`download`, identity, manifest.corpus)
	return identity
}

export async function writeComplete(
	handle: {
		write(
			payload: Uint8Array,
			offset: number,
			length: number,
		): Promise<{ bytesWritten: number }>
	},
	payload: Uint8Array,
): Promise<void> {
	let offset = 0
	while (offset < payload.byteLength) {
		const { bytesWritten } = await handle.write(
			payload,
			offset,
			payload.byteLength - offset,
		)
		if (bytesWritten <= 0) {
			throw new Error(`Unable to make progress while writing corpus data.`)
		}
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
				const expected = manifest.variants[id as VariantId]
				if (actual.filename !== expected.filename) {
					throw new Error(
						`variant ${id} used ${actual.filename}; expected ${expected.filename}.`,
					)
				}
				assertIdentity(`variant ${id}`, actual, expected)
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

export function validateManifest(value: unknown): CorpusManifest {
	const candidate = expectRecord(value, `manifest`)
	if (candidate[`schemaVersion`] !== 1) {
		throw new TypeError(`Manifest schemaVersion must be 1.`)
	}

	const corpus = expectRecord(candidate[`corpus`], `manifest.corpus`)
	expectNonEmptyString(corpus[`id`], `manifest.corpus.id`)
	expectNonEmptyString(corpus[`title`], `manifest.corpus.title`)
	expectNonEmptyString(corpus[`author`], `manifest.corpus.author`)
	expectHttpsUrl(corpus[`landingUrl`], `manifest.corpus.landingUrl`)
	expectHttpsUrl(corpus[`sourceUrl`], `manifest.corpus.sourceUrl`)
	expectHttpsUrl(corpus[`mirrorUrl`], `manifest.corpus.mirrorUrl`)
	expectHttpsUrl(corpus[`mirrorReleaseUrl`], `manifest.corpus.mirrorReleaseUrl`)
	expectTimestamp(
		corpus[`mirrorPublishedAt`],
		`manifest.corpus.mirrorPublishedAt`,
	)
	expectDate(corpus[`retrievedAt`], `manifest.corpus.retrievedAt`)
	expectPositiveInteger(corpus[`bytes`], `manifest.corpus.bytes`)
	expectPositiveInteger(corpus[`lines`], `manifest.corpus.lines`)
	expectDigest(corpus[`sha256`], `manifest.corpus.sha256`)
	expectNonEmptyString(corpus[`provenance`], `manifest.corpus.provenance`)
	const license = expectRecord(corpus[`license`], `manifest.corpus.license`)
	expectNonEmptyString(license[`status`], `manifest.corpus.license.status`)
	expectNonEmptyString(license[`note`], `manifest.corpus.license.note`)

	const variants = expectRecord(candidate[`variants`], `manifest.variants`)
	const variantKeys = Object.keys(variants).sort()
	const requiredKeys = [...VARIANT_IDS].sort()
	if (
		variantKeys.length !== requiredKeys.length ||
		variantKeys.some((key, index) => key !== requiredKeys[index])
	) {
		throw new TypeError(
			`manifest.variants must contain exactly: ${requiredKeys.join(`, `)}.`,
		)
	}

	const filenames = new Set<string>()
	for (const id of VARIANT_IDS) {
		const label = `manifest.variants.${id}`
		const variant = expectRecord(variants[id], label)
		const filename = expectNonEmptyString(
			variant[`filename`],
			`${label}.filename`,
		)
		if (
			filename === `.` ||
			filename === `..` ||
			filename === `report.json` ||
			/[\\/]/u.test(filename) ||
			!filename.endsWith(`.md`)
		) {
			throw new TypeError(
				`${label}.filename must be a unique Markdown basename other than report.json.`,
			)
		}
		if (filenames.has(filename)) {
			throw new TypeError(`Duplicate variant filename: ${filename}.`)
		}
		filenames.add(filename)
		expectNonEmptyString(variant[`description`], `${label}.description`)
		expectPositiveInteger(variant[`bytes`], `${label}.bytes`)
		expectDigest(variant[`sha256`], `${label}.sha256`)
	}

	return value as CorpusManifest
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
		throw new CorpusIntegrityError(
			`${label} failed integrity verification: expected ${expected.bytes} bytes / ${expected.sha256}, received ${actual.bytes} bytes / ${actual.sha256}.`,
		)
	}
}

class CorpusIntegrityError extends Error {
	public override name = `CorpusIntegrityError`
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== `object` || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object.`)
	}
	return value as Record<string, unknown>
}

function expectNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== `string` || value.trim().length === 0) {
		throw new TypeError(`${label} must be a non-empty string.`)
	}
	return value
}

function expectPositiveInteger(value: unknown, label: string): number {
	if (typeof value !== `number` || !Number.isInteger(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive integer.`)
	}
	return value
}

function expectDigest(value: unknown, label: string): string {
	const digest = expectNonEmptyString(value, label)
	if (!/^[a-f\d]{64}$/u.test(digest)) {
		throw new TypeError(`${label} must be a lowercase SHA-256 digest.`)
	}
	return digest
}

function expectHttpsUrl(value: unknown, label: string): string {
	const source = expectNonEmptyString(value, label)
	let url: URL
	try {
		url = new URL(source)
	} catch (error) {
		throw new TypeError(`${label} must be a valid HTTPS URL.`, { cause: error })
	}
	if (url.protocol !== `https:`) {
		throw new TypeError(`${label} must be a valid HTTPS URL.`)
	}
	return source
}

function expectDate(value: unknown, label: string): string {
	const date = expectNonEmptyString(value, label)
	if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(date))) {
		throw new TypeError(`${label} must be an ISO calendar date.`)
	}
	return date
}

function expectTimestamp(value: unknown, label: string): string {
	const timestamp = expectNonEmptyString(value, label)
	if (Number.isNaN(Date.parse(timestamp))) {
		throw new TypeError(`${label} must be an ISO timestamp.`)
	}
	return timestamp
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
			await writeComplete(handle, source)
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

async function replaceFile(
	sourcePath: string,
	targetPath: string,
): Promise<void> {
	try {
		await fs.rename(sourcePath, targetPath)
	} catch (error) {
		if (!hasErrorCode(error, `EEXIST`, `EACCES`, `EPERM`)) throw error
		await fs.rm(targetPath, { force: true })
		await fs.rename(sourcePath, targetPath)
	}
}

function isMissingFile(error: unknown): boolean {
	return hasErrorCode(error, `ENOENT`)
}

function hasErrorCode(error: unknown, ...codes: string[]): boolean {
	return (
		error instanceof Error &&
		`code` in error &&
		codes.includes((error as NodeJS.ErrnoException).code ?? ``)
	)
}
