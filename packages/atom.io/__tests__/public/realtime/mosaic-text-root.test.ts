import { createHash } from "node:crypto"

import {
	createMosaicTextRootReader,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicDomainCheckpointObjectKey,
	type MosaicDomainIdentity,
	type MosaicTextRootObject,
	type MosaicTextRootWriteAdapter,
	stageMosaicTextRootImport,
	stageMosaicTextRootImportStream,
	stageMosaicTextRootReplace,
} from "atom.io/realtime"
import {
	createMosaicDomainCheckpointCoordinator,
	createMosaicTextRootCheckpointReader,
	createMosaicTextRootCheckpointStage,
	InMemoryMosaicDomainCheckpointStorage,
	MOSAIC_TEXT_ROOT_REFERENCE_COUNT_INDEX,
} from "atom.io/realtime-server"
import { describe, expect, test } from "vitest"

const canonicalize = (value: unknown): string => {
	if (value === null || typeof value !== `object`) return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(`,`)}]`
	const object = value as Readonly<Record<string, unknown>>
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
		.join(`,`)}}`
}

class MemoryTextRootStore implements MosaicTextRootWriteAdapter {
	public readonly objects = new Map<
		MosaicDomainCheckpointObjectKey,
		MosaicTextRootObject
	>()

	public put(object: MosaicTextRootObject): MosaicDomainCheckpointObjectKey {
		const key = `sha256:${createHash(`sha256`)
			.update(canonicalize(object))
			.digest(`hex`)}` as const
		const prior = this.objects.get(key)
		if (prior !== undefined && canonicalize(prior) !== canonicalize(object)) {
			throw new Error(`content collision`)
		}
		this.objects.set(key, structuredClone(object))
		return key
	}

	public read(
		key: MosaicDomainCheckpointObjectKey,
	): MosaicTextRootObject | null {
		const value = this.objects.get(key)
		return value === undefined ? null : structuredClone(value)
	}
}

describe(`Mosaic Text v3 storage roots`, () => {
	test(`publishes and reopens reference-counted roots through a real checkpoint`, async () => {
		const identity: MosaicDomainIdentity = {
			definition: { key: `mosaic-text-root-test`, version: 3 },
			instance: `document`,
		}
		const address = { domain: identity, key: `root`, member: `source` }
		const storage = new InMemoryMosaicDomainCheckpointStorage()
		const stage = createMosaicTextRootCheckpointStage({
			baseRevision: 1,
			domain: identity,
			storage,
		})
		const imported = await stageMosaicTextRootImport(stage, `initial text`)
		const external = await stage.stage(imported.root)
		let publication = { externalRoot: external.rootKey, root: imported.root }
		const appended = await storage.appendBatch({
			accepted: {
				batch: {
					affectedMembers: [address],
					actor: `actor`,
					dependencies: [],
					domain: identity,
					group: `import`,
					id: `import`,
					operations: [
						{
							address,
							id: `import:root`,
							model: { key: `mosaic-text-root`, version: 3 },
							operation: { publication, type: `publish-text-root` },
						},
					],
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					sequence: 1,
					session: `session`,
				},
				revision: 1,
			},
			expectedRevision: 0,
			fingerprint: `import`,
		})
		expect(appended.status).toBe(`accepted`)
		const coordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [publication.externalRoot],
			readMember: () => publication,
			storage,
		})
		await coordinator.checkpoint()
		const rootKey = imported.root.reference!.key
		expect(
			await coordinator.readExternalIndexes(external.rootKey, [
				{
					index: MOSAIC_TEXT_ROOT_REFERENCE_COUNT_INDEX,
					path: rootKey.slice(`sha256:`.length),
				},
			]),
		).toMatchObject([{ value: 1 }])

		const reader = createMosaicTextRootCheckpointReader({
			checkpoint: coordinator,
			rootKey: external.rootKey,
		})
		expect(await reader.referenceCount(rootKey)).toBe(1)
		const editStage = createMosaicTextRootCheckpointStage({
			baseRevision: 2,
			domain: identity,
			previous: reader,
			previousRootKey: external.rootKey,
			storage,
		})
		const edited = await stageMosaicTextRootReplace(
			editStage,
			imported.root,
			{ end: 7, start: 0 },
			`changed`,
		)
		const nextExternal = await editStage.stage(edited.root)
		publication = { externalRoot: nextExternal.rootKey, root: edited.root }
		expect(publication.root.reference?.key).not.toBe(rootKey)
	})

	test(`streaming import is chunk-boundary invariant across Unicode and CRLF`, async () => {
		const text = `${`alpha\r\n`.repeat(20_000)}👩🏽‍💻e\u0301${`omega`.repeat(
			20_000,
		)}`
		const directStore = new MemoryTextRootStore()
		const streamedStore = new MemoryTextRootStore()
		const direct = await stageMosaicTextRootImport(directStore, text)
		const chunks = async function* () {
			await Promise.resolve()
			let cursor = 0
			const widths = [1, 2, 7, 31, 257, 4_093]
			for (let index = 0; cursor < text.length; index++) {
				const end = Math.min(text.length, cursor + widths[index % widths.length])
				yield text.slice(cursor, end)
				cursor = end
			}
		}
		const streamed = await stageMosaicTextRootImportStream(
			streamedStore,
			chunks(),
		)
		expect(streamed.root).toEqual(direct.root)
		expect(streamedStore.objects).toEqual(directStore.objects)

		const oversizedGrapheme = async function* () {
			await Promise.resolve()
			yield `e${`\u0301`.repeat(65_536)}`
		}
		await expect(
			stageMosaicTextRootImportStream(
				new MemoryTextRootStore(),
				oversizedGrapheme(),
			),
		).rejects.toThrow(`grapheme exceeds`)
	})

	test(`path-copies only addressed leaves and reads bounded resident ranges`, async () => {
		const store = new MemoryTextRootStore()
		const text = `${`a`.repeat(40_000)}\n${`b`.repeat(100_000)}\n${`c`.repeat(
			100_000,
		)}`
		const imported = await stageMosaicTextRootImport(store, text)
		expect(imported.root.version).toBe(3)
		expect(imported.counters.objectReads).toBe(0)
		expect(imported.counters.leavesWritten).toBeGreaterThan(3)
		const objectsAfterImport = store.objects.size

		const edited = await stageMosaicTextRootReplace(
			store,
			imported.root,
			{ end: 120_032, start: 119_968 },
			`[local]`,
		)
		expect(edited.counters.objectReads).toBeLessThanOrEqual(3)
		expect(edited.counters.leavesVisited).toBe(1)
		expect(edited.counters.branchesVisited).toBeLessThanOrEqual(2)
		expect(edited.counters.leavesWritten).toBeLessThanOrEqual(2)
		expect(edited.counters.utf16Scanned).toBeLessThan(400_000)
		expect(store.objects.size - objectsAfterImport).toBeLessThanOrEqual(4)

		const reader = createMosaicTextRootReader(store)
		const projection = await reader.readRange(edited.root, {
			end: 120_048,
			start: 119_952,
		})
		expect(projection.text).toContain(`[local]`)
		expect(projection.counters.objectReads).toBeLessThanOrEqual(3)
		expect(projection.counters.utf16Scanned).toBeLessThan(70_000)
	})

	test(`cross-leaf replacement preserves untouched content and root identity`, async () => {
		const store = new MemoryTextRootStore()
		const text = `${`left`.repeat(20_000)}${`middle`.repeat(20_000)}${`right`.repeat(
			20_000,
		)}`
		const first = await stageMosaicTextRootImport(store, text)
		const duplicate = await stageMosaicTextRootImport(store, text)
		expect(duplicate.root.reference?.key).toBe(first.root.reference?.key)

		const start = 79_900
		const end = 200_100
		const replacement = `👩🏽‍💻 replacement e\u0301`
		const edited = await stageMosaicTextRootReplace(
			store,
			first.root,
			{ end, start },
			replacement,
		)
		const reader = createMosaicTextRootReader(store)
		const recovered = await reader.readRange(
			edited.root,
			{
				end: edited.root.reference!.summary.utf16Units,
				start: 0,
			},
			256,
		)
		expect(recovered.text).toBe(
			`${text.slice(0, start)}${replacement}${text.slice(end)}`,
		)
	})

	test(`fails closed on grapheme splits, missing objects, and hydration limits`, async () => {
		const store = new MemoryTextRootStore()
		const imported = await stageMosaicTextRootImport(
			store,
			`A👩🏽‍💻e\u0301${`z`.repeat(200_000)}`,
		)
		await expect(
			stageMosaicTextRootReplace(store, imported.root, { end: 2, start: 1 }, ``),
		).rejects.toThrow(`grapheme cluster`)
		const reader = createMosaicTextRootReader(store)
		await expect(
			reader.resolveUtf16Boundary(imported.root, 2, `left`),
		).resolves.toMatchObject({ offset: 1 })
		await expect(
			reader.resolveUtf16Boundary(imported.root, 2, `right`),
		).resolves.toMatchObject({ offset: 8 })
		await expect(
			reader.readRange(imported.root, { end: 200_000, start: 0 }, 1),
		).rejects.toThrow(`exceeded 1 objects`)

		const key = imported.root.reference!.key
		const original = store.objects.get(key)!
		if (original.kind !== `mosaic-text-root-branch`) {
			throw new Error(`Expected a branch fixture.`)
		}
		store.objects.set(key, {
			...original,
			children: [...original.children].reverse(),
		})
		await expect(
			createMosaicTextRootReader(store).readRange(imported.root, {
				end: 1,
				start: 0,
			}),
		).rejects.toThrow(`content key`)

		store.objects.delete(key)
		await expect(
			createMosaicTextRootReader(store).readRange(imported.root, {
				end: 1,
				start: 0,
			}),
		).rejects.toThrow(`Invalid Mosaic Text v3 root object`)
	})

	test(`randomized path copies remain equivalent to a flat UTF-16 oracle`, async () => {
		const store = new MemoryTextRootStore()
		let oracle = `seed:${`abcdef\n`.repeat(20_000)}`
		let root = (await stageMosaicTextRootImport(store, oracle)).root
		let random = 0x21_50_03
		const next = (): number => {
			random = (Math.imul(random, 1_664_525) + 1_013_904_223) >>> 0
			return random
		}
		for (let operation = 0; operation < 100; operation++) {
			const start = next() % (oracle.length + 1)
			const end = Math.min(oracle.length, start + (next() % 96))
			const inserted = `[${operation}:${next().toString(16)}]`
			root = (
				await stageMosaicTextRootReplace(store, root, { end, start }, inserted)
			).root
			oracle = `${oracle.slice(0, start)}${inserted}${oracle.slice(end)}`
		}
		const result = await createMosaicTextRootReader(store).readRange(
			root,
			{ end: oracle.length, start: 0 },
			512,
		)
		expect(result.text).toBe(oracle)
	})
})
