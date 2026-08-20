import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import {
	deriveVariants,
	makeFenced,
	makeHeadingRich,
	makeUnicodeAdversarial,
	makeVeryLongParagraph,
	manifest,
	prepareCorpus,
	resolveCacheLayout,
	resolveCacheRoot,
	resolveCorpusUrl,
	validateManifest,
	verifySource,
	verifySourceIfPresent,
	writeComplete,
} from "./large-document-corpus"
import { MOSAIC_TEXT_TRUSTED_IMPORT_MAX_STAGED_BYTES } from "./mosaic-text-root-scale-service"
import {
	MOSAIC_TEXT_SCALE_FAULTS,
	MOSAIC_TEXT_SCALE_MAX_REPLAY_STEPS,
	mosaicTextScaleFailure,
} from "./mosaic-text-scalability"
import {
	mosaicTextScaleFaultSchedule,
	validateMarkdownEditorCorpus,
} from "./validate-markdown-editor-corpus"

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { force: true, recursive: true })),
	)
})

describe(`large-document corpus tooling`, () => {
	test(`pins complete provenance and licensing metadata`, () => {
		expect(manifest.corpus).toMatchObject({
			bytes: 5_638_480,
			landingUrl: `https://www.gutenberg.org/ebooks/100`,
			lines: 196_398,
			retrievedAt: `2026-08-13`,
			sha256: `3cf4b3d44ee14cff4e14e78e2ad3318eff76f3f7f2afc3cee6bb925879110a37`,
			sourceUrl: `https://www.gutenberg.org/cache/epub/100/pg100.txt`,
		})
		expect(manifest.corpus.mirrorUrl).toContain(`/releases/download/`)
		expect(manifest.corpus.mirrorReleaseUrl).toContain(`/releases/tag/`)
		expect(manifest.corpus.mirrorPublishedAt).toBe(`2026-08-14T23:40:11Z`)
		expect(manifest.corpus.license.note).toContain(`jurisdiction`)
	})

	test(`validates the complete source and variant manifest`, () => {
		const missingVariant = structuredClone(manifest)
		delete (missingVariant.variants as Partial<typeof manifest.variants>).fenced
		expect(() => validateManifest(missingVariant)).toThrow(
			`manifest.variants must contain exactly`,
		)

		const invalidDigest = structuredClone(manifest)
		invalidDigest.variants.headingRich.sha256 = `not-a-digest`
		expect(() => validateManifest(invalidDigest)).toThrow(
			`manifest.variants.headingRich.sha256`,
		)

		const unsafeFilename = structuredClone(manifest)
		unsafeFilename.variants.headingRich.filename = `../heading-rich.md`
		expect(() => validateManifest(unsafeFilename)).toThrow(
			`manifest.variants.headingRich.filename`,
		)

		const duplicateFilename = structuredClone(manifest)
		duplicateFilename.variants.headingRich.filename =
			duplicateFilename.variants.fenced.filename
		expect(() => validateManifest(duplicateFilename)).toThrow(
			`Duplicate variant filename`,
		)
	})

	test(`uses platform cache conventions unless explicitly configured`, () => {
		expect(resolveCacheRoot({}, `darwin`, `/Users/atom`)).toBe(
			path.join(
				`/Users/atom`,
				`Library`,
				`Caches`,
				`atom.io`,
				`large-document-corpus`,
			),
		)
		expect(
			resolveCacheRoot(
				{ LOCALAPPDATA: `/local-cache` },
				`win32`,
				`C:/Users/atom`,
			),
		).toBe(path.join(`/local-cache`, `atom.io`, `large-document-corpus`))
		expect(
			resolveCacheRoot({ XDG_CACHE_HOME: `/xdg-cache` }, `linux`, `/home/atom`),
		).toBe(path.join(`/xdg-cache`, `atom.io`, `large-document-corpus`))
		expect(
			resolveCacheRoot(
				{ ATOM_IO_LARGE_DOCUMENT_CACHE: `/configured` },
				`linux`,
				`/home/atom`,
			),
		).toBe(path.resolve(`/configured`))
	})

	test(`applies byte-stable transforms to a small offline fixture`, () => {
		const source = `Alpha\n\nBeta  gamma\n`
		expect(makeHeadingRich(source)).toBe(`## Alpha\n\nBeta  gamma\n`)
		expect(makeVeryLongParagraph(source)).toBe(`Alpha Beta gamma\n`)
		expect(makeFenced(source)).toBe(`\`\`\`text\nAlpha\n\nBeta  gamma\n\`\`\`\n`)
		expect(makeUnicodeAdversarial(2)).toMatchSnapshot()
		const deriveFixture = () =>
			[
				makeHeadingRich(source),
				makeVeryLongParagraph(source),
				makeFenced(source),
				makeUnicodeAdversarial(2),
			].map((variant) => createHash(`sha256`).update(variant).digest(`hex`))
		expect(deriveFixture()).toEqual(deriveFixture())
		expect(deriveFixture()).toEqual([
			`57fc4ab1fa7bc8496eb7e075a724d9242423bc4b779135ce2130f233cb75c04a`,
			`656c78239db47023e3c0e81c19426de2b43a8b86377e5035d170cecede7b1883`,
			`31766a8b99d0cdcfb06443fa5edcfa3f1681a0161d57467412e1dc8e741c2595`,
			`2ec06eb745648f3a9704b856cc0dc1e9c6f50585f27f795e72e98c25787861de`,
		])
	})

	test(`runs the bounded editor viewport and parser contract without document sharding`, async () => {
		const cacheRoot = await makeTemporaryDirectory()
		const canonical = path.join(cacheRoot, `canonical.md`)
		const repeated = path.join(cacheRoot, `repeated.md`)
		await fs.writeFile(canonical, `# Heading\n\n${`alpha `.repeat(1_000)}`)
		await fs.writeFile(repeated, `\`\`\`text\n${`beta `.repeat(10_000)}\n\`\`\``)
		const result = await validateMarkdownEditorCorpus([canonical, repeated], {
			stabilizationOperations: 1_001,
			timeoutMsPerDocument: 30_000,
		})
		expect(result.documents).toHaveLength(2)
		for (const document of result.documents) {
			expect(document.convergence.domainRevision).toBeGreaterThan(1)
			expect(document.import.leavesWritten).toBeGreaterThan(0)
			expect(document.import.stagedBytes).toBeLessThan(
				MOSAIC_TEXT_TRUSTED_IMPORT_MAX_STAGED_BYTES,
			)
			expect(document.local.serializedBatchBytes).toBeLessThan(32 * 1024)
			expect(document.local.memberLoads).toBeLessThan(256)
			expect(document.samples).toBe(3)
			expect(document.maximumScannedUtf16Units).toBeLessThan(65_536)
			expect(document.maximumMountedBlocks).toBeLessThan(2_000)
			expect(document.maximumResidentBytes).toBeLessThan(256 * 1024)
			expect(document.maximumFullDocumentReplicas).toBe(1)
			expect(document.local.persistedBytes).toBeLessThan(4 * 1024 * 1024)
			expect(document.local.checkpointBytes).toBeLessThan(512 * 1024)
			expect(document.maximumDeliveredBytes).toBeLessThan(384 * 1024)
			expect(document.convergence.transcript).toContain(
				`history:individual-foreign-safe-undo-redo`,
			)
			expect(document.convergence.clientRevisions).toEqual({
				ada: document.convergence.domainRevision,
				delayed: document.convergence.domainRevision,
				lin: document.convergence.domainRevision,
			})
			expect(document.convergence.history.ada.redo).toBe(0)
			expect(document.convergence.indexSummary.utf16Units).toBeGreaterThan(0)
		}
		expect(new Set(result.faultSchedule)).toEqual(
			new Set(MOSAIC_TEXT_SCALE_FAULTS),
		)
		expect(result.faultSchedule).toEqual(
			mosaicTextScaleFaultSchedule(result.seed),
		)
		expect(result.stabilization.operations).toBe(1_001)
		expect(result.stabilization.retainedActions).toBeLessThanOrEqual(104)
		expect(result.stabilization.domainReceipts).toBeLessThanOrEqual(4_096)
		expect(result.stabilization.domainOperationReceipts).toBeLessThanOrEqual(
			4_096,
		)
		expect(result.stabilization.domainTailBatches).toBeLessThanOrEqual(256)
		expect(result.stabilization.domainSessionWatermarks).toBe(1)
		expect(result.stabilization.checkpointObjects).toBeLessThanOrEqual(64)
		expect(result.stabilization.splitMergeVerified).toBe(true)
		expect(result.stabilization.staleAliasRecoveryVerified).toBe(true)
	})

	test(`seeds real fault order and emits bounded replay diagnostics`, () => {
		const first = mosaicTextScaleFaultSchedule(1)
		const second = mosaicTextScaleFaultSchedule(2)
		expect(first).not.toEqual(second)
		expect(new Set(first)).toEqual(new Set(MOSAIC_TEXT_SCALE_FAULTS))
		const diagnostic = {
			clientSchedule: [`ada:edit`],
			domainRevision: 7,
			faultSchedule: first,
			memberRevisions: { source: 7, "client:ada": 6 },
			residentRanges: { ada: [{ end: 32, start: 16 }] },
			seed: 1,
			transcript: [`open:{\"file\":\"fixture.md\"}`, `fault:delay`],
		}
		const failure = mosaicTextScaleFailure(
			new Error(`fixture failed`),
			diagnostic,
		)
		expect(failure.message).toContain(`MOSAIC_TEXT_SCALE_REPLAY=`)
		expect(failure.message).toContain(`\"seed\":1`)
		expect(failure.message).toContain(`\"residentRanges\"`)
		expect(failure.message).toContain(`\"client:ada\":6`)
		expect(diagnostic.transcript.length).toBeLessThanOrEqual(
			MOSAIC_TEXT_SCALE_MAX_REPLAY_STEPS,
		)
		const oversized = mosaicTextScaleFailure(new Error(`fixture failed`), {
			...diagnostic,
			transcript: Array.from(
				{ length: MOSAIC_TEXT_SCALE_MAX_REPLAY_STEPS + 1 },
				(_, index) => `command:${index}`,
			),
		})
		const replay = JSON.parse(
			oversized.message.slice(
				oversized.message.indexOf(`MOSAIC_TEXT_SCALE_REPLAY=`) +
					`MOSAIC_TEXT_SCALE_REPLAY=`.length,
			),
		) as { transcript: readonly string[] }
		expect(replay.transcript).toHaveLength(2)
		expect(replay.transcript[1]).toContain(`command:32`)
	})

	test(`completes short writes before reporting generated bytes`, async () => {
		const payload = new TextEncoder().encode(`abcdefghijk`)
		const written: number[] = []
		await writeComplete(
			{
				write(input, offset, length) {
					const bytesWritten = Math.min(3, length)
					written.push(...input.subarray(offset, offset + bytesWritten))
					return Promise.resolve({ bytesWritten })
				},
			},
			payload,
		)
		expect(Uint8Array.from(written)).toEqual(payload)
		await expectFailure(
			writeComplete(
				{
					write: () => Promise.resolve({ bytesWritten: 0 }),
				},
				payload,
			),
			`Unable to make progress`,
		)
	})

	test(`uses the first-party mirror unless upstream is explicit`, async () => {
		expect(resolveCorpusUrl()).toBe(manifest.corpus.mirrorUrl)
		expect(resolveCorpusUrl(`mirror`)).toBe(manifest.corpus.mirrorUrl)
		expect(resolveCorpusUrl(`upstream`)).toBe(manifest.corpus.sourceUrl)

		const cacheRoot = await makeTemporaryDirectory()
		let requestedUrl: string | undefined
		const response = new Response(`intentionally invalid fixture`)
		await expectFailure(
			prepareCorpus({
				cacheRoot,
				fetchImpl: (input) => {
					requestedUrl = input
					return Promise.resolve(response)
				},
			}),
			`did not match the pinned manifest`,
		)
		expect(requestedUrl).toBe(manifest.corpus.mirrorUrl)
		expect(response.body?.locked).toBeFalse()
	})

	test(`repairs a corrupt cache only after a verified replacement exists`, async () => {
		const cacheRoot = await makeTemporaryDirectory()
		const layout = resolveCacheLayout(cacheRoot)
		await fs.mkdir(layout.corpusDir, { recursive: true })
		await fs.writeFile(layout.sourcePath, `corrupt cache entry`)
		let requests = 0

		await expectFailure(
			prepareCorpus({
				cacheRoot,
				fetchImpl: () => {
					requests += 1
					return Promise.resolve(new Response(`invalid replacement`))
				},
			}),
			`Downloaded corpus did not match`,
		)

		expect(requests).toBe(1)
		expect(await fs.readFile(layout.sourcePath, `utf8`)).toBe(
			`corrupt cache entry`,
		)
		expect(await fs.readdir(layout.corpusDir)).toEqual([`source.txt`])
	})

	test(`rejects a poisoned cache before parsing it`, async () => {
		const cacheRoot = await makeTemporaryDirectory()
		const layout = resolveCacheLayout(cacheRoot)
		await fs.mkdir(layout.corpusDir, { recursive: true })
		await fs.writeFile(layout.sourcePath, `not the pinned corpus`)

		await expectFailure(
			verifySource(layout.sourcePath),
			`failed integrity verification`,
		)
		await expectFailure(
			deriveVariants({ cacheRoot }),
			`failed integrity verification`,
		)
	})

	test(`aborts an oversized download without accepting a file`, async () => {
		const cacheRoot = await makeTemporaryDirectory()
		const chunkBytes = 64 * 1024
		let cancelled = false
		let emittedBytes = 0
		const oversized = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true
			},
			pull(controller) {
				controller.enqueue(new Uint8Array(chunkBytes))
				emittedBytes += chunkBytes
			},
		})

		await expectFailure(
			prepareCorpus({
				cacheRoot,
				fetchImpl: () => Promise.resolve(new Response(oversized)),
			}),
			`exceeded the pinned`,
		)
		const layout = resolveCacheLayout(cacheRoot)
		expect(cancelled).toBeTrue()
		expect(oversized.locked).toBeFalse()
		expect(emittedBytes).toBeLessThan(manifest.corpus.bytes + 2 * chunkBytes)
		const missingSource = await expectFailure(
			fs.stat(layout.sourcePath),
			`ENOENT`,
		)
		expect(missingSource).toMatchObject({
			code: `ENOENT`,
		})
		expect(await fs.readdir(layout.corpusDir)).toEqual([])
	})

	test(`distinguishes an absent corpus from an integrity failure`, async () => {
		const cacheRoot = await makeTemporaryDirectory()
		const layout = resolveCacheLayout(cacheRoot)
		await expectFailure(verifySource(layout.sourcePath), `Corpus is absent`)
		expect(await verifySourceIfPresent(layout.sourcePath)).toEqual({
			status: `skipped`,
		})

		await fs.mkdir(layout.corpusDir, { recursive: true })
		await fs.writeFile(layout.sourcePath, `corrupt`)
		await expectFailure(
			verifySourceIfPresent(layout.sourcePath),
			`failed integrity verification`,
		)
	})

	test(`the CLI skips only an absent optional corpus`, async () => {
		const cacheRoot = await makeTemporaryDirectory()
		const absent = Bun.spawn({
			cmd: [
				process.execPath,
				path.join(import.meta.dir, `large-document-corpus.bun.ts`),
				`verify`,
				`--if-present`,
				`--cache-root=${cacheRoot}`,
			],
			stderr: `pipe`,
			stdout: `pipe`,
		})
		expect(await absent.exited).toBe(0)
		expect(await new Response(absent.stdout).text()).toStartWith(`SKIPPED`)

		const layout = resolveCacheLayout(cacheRoot)
		await fs.mkdir(layout.corpusDir, { recursive: true })
		await fs.writeFile(layout.sourcePath, `corrupt`)
		const corrupt = Bun.spawn({
			cmd: [
				process.execPath,
				path.join(import.meta.dir, `large-document-corpus.bun.ts`),
				`verify`,
				`--if-present`,
				`--cache-root=${cacheRoot}`,
			],
			stderr: `pipe`,
			stdout: `pipe`,
		})
		expect(await corrupt.exited).toBe(1)
		expect(await new Response(corrupt.stderr).text()).toStartWith(`FAILED`)
	})
})

async function makeTemporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(
		path.join(os.tmpdir(), `atom-io-corpus-test-`),
	)
	temporaryDirectories.push(directory)
	return directory
}

async function expectFailure(
	operation: Promise<unknown>,
	expectedMessage: string,
): Promise<Error> {
	let failure: unknown
	try {
		await operation
	} catch (error) {
		failure = error
	}
	expect(failure).toBeInstanceOf(Error)
	expect((failure as Error).message).toContain(expectedMessage)
	return failure as Error
}
