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
	resolveCorpusUrl,
	verifySource,
	verifySourceIfPresent,
} from "./large-document-corpus"

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
		expect(manifest.corpus.license.note).toContain(`jurisdiction`)
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

	test(`uses the first-party mirror unless upstream is explicit`, async () => {
		expect(resolveCorpusUrl()).toBe(manifest.corpus.mirrorUrl)
		expect(resolveCorpusUrl(`mirror`)).toBe(manifest.corpus.mirrorUrl)
		expect(resolveCorpusUrl(`upstream`)).toBe(manifest.corpus.sourceUrl)

		const cacheRoot = await makeTemporaryDirectory()
		let requestedUrl: string | undefined
		await expectFailure(
			prepareCorpus({
				cacheRoot,
				fetchImpl: (input) => {
					requestedUrl = input
					return Promise.resolve(new Response(`intentionally invalid fixture`))
				},
			}),
			`did not match the pinned manifest`,
		)
		expect(requestedUrl).toBe(manifest.corpus.mirrorUrl)
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
