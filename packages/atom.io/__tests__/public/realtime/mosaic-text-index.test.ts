import { atomFamily, Silo } from "atom.io"
import {
	composeMosaicTextIndexedGesture,
	createMosaicTextIndex,
	createMosaicTextIndexReader,
	maintainMosaicTextIndex,
	mosaicDomain,
	mosaicText,
	mosaicTextIndexAliasKey,
	type MosaicTextIndexBundle,
	type MosaicTextIndexFragment,
	mosaicTextIndexFragments,
	type MosaicTextIndexMember,
	MosaicTextIndexRangeRecoveryError,
	type MosaicTextIndexRoot,
	mosaicTextIndexSource,
} from "atom.io/realtime"
import * as RTT from "atom.io/realtime-testing/headless"
import { z } from "zod"

const compact = {
	maximumAliasGenerations: 3,
	maximumAliasTargets: 3,
	maximumChildrenPerNode: 4,
	maximumFragmentsPerLeaf: 4,
	maximumLeafGraphemes: 8,
	maximumLeafUtf16Units: 32,
	minimumChildrenPerNode: 2,
	minimumLeafGraphemes: 2,
	targetChildrenPerNode: 3,
	targetLeafGraphemes: 4,
} as const

const fragment = (
	text: string,
	runId = `run`,
	start = 0,
): MosaicTextIndexFragment => ({ runId, start, text })

const membersOf = <Kind extends MosaicTextIndexMember[`kind`]>(
	bundle: MosaicTextIndexBundle,
	kind: Kind,
): Extract<MosaicTextIndexMember, { kind: Kind }>[] =>
	bundle.members.filter(
		(member): member is Extract<MosaicTextIndexMember, { kind: Kind }> =>
			member.kind === kind,
	)

describe(`Mosaic bounded text index`, () => {
	test(`stores bounded leaves and bounded-fanout nodes without a flat root`, () => {
		const singleLine = `x`.repeat(80)
		const fenced = `\n\`\`\`ts\n${`const value = 1\n`.repeat(8)}\`\`\`\n`
		const index = createMosaicTextIndex([fragment(singleLine + fenced)], compact)
		const leaves = membersOf(index, `leaf`)
		const nodes = membersOf(index, `node`)

		expect(leaves.length).toBeGreaterThan(20)
		expect(leaves.every(({ summary }) => summary.graphemes <= 8)).toBe(true)
		expect(leaves.every(({ summary }) => summary.utf16Units <= 32)).toBe(true)
		expect(leaves.every(({ fragments }) => fragments.length <= 4)).toBe(true)
		expect(nodes.every(({ children }) => children.length <= 4)).toBe(true)
		expect(index.root.reference?.summary.utf16Units).toBe(
			singleLine.length + fenced.length,
		)
		expect(Object.keys(index.root)).toEqual([
			`generation`,
			`id`,
			`kind`,
			`reference`,
			`version`,
		])
		expect(JSON.stringify(index.root)).not.toContain(leaves.at(-1)?.id)
	})

	test(`uses logarithmic summary paths for Unicode offset, grapheme, and line lookup`, async () => {
		const text = Array.from({ length: 128 }, (_, index) =>
			index % 11 === 0 ? `👨‍👩‍👧‍👦\n` : `a`,
		).join(``)
		const index = createMosaicTextIndex([fragment(text)], compact)
		const reader = createMosaicTextIndexReader(mosaicTextIndexSource(index))
		const offset = await reader.positionAtOffset(10)
		const grapheme = await reader.positionAtGrapheme(17)
		const line = await reader.positionAtLine(5)

		expect(offset.position.runId).toBe(`run`)
		expect(grapheme.position).toMatchObject({ runId: `run` })
		expect(line.globalLine).toBe(5)
		expect(reader.counters.leaves).toBe(3)
		expect(reader.counters.nodes).toBeLessThanOrEqual(12)
		expect(reader.counters.nodes).toBeLessThan(membersOf(index, `leaf`).length)
	})

	test(`resolves only a bounded resident range and requests structured recovery`, async () => {
		const index = createMosaicTextIndex([fragment(`a`.repeat(64))], compact)
		const reads: string[] = []
		const source = mosaicTextIndexSource(index)
		const reader = createMosaicTextIndexReader({
			read: async (id) => {
				reads.push(id)
				return source.read(id)
			},
			root: source.root,
		})

		const resident = await reader.resolveRange(
			{ end: 7, kind: `utf16-range`, start: 3 },
			3,
		)
		expect(resident).toMatchObject({ status: `ok` })
		if (resident.status === `ok`) expect(resident.leafIds).toHaveLength(2)
		expect(reads.length).toBeLessThan(membersOf(index, `node`).length)
		const boundary = await reader.resolveRange(
			{ end: 8, kind: `utf16-range`, start: 4 },
			3,
		)
		expect(boundary).toMatchObject({ status: `ok` })
		if (boundary.status === `ok`) expect(boundary.leafIds).toHaveLength(1)
		const caret = await reader.resolveRange(
			{ end: 4, kind: `utf16-range`, start: 4 },
			3,
		)
		expect(caret).toEqual(boundary)
		const eof = await reader.resolveRange(
			{ end: 64, kind: `utf16-range`, start: 64 },
			3,
		)
		expect(eof).toMatchObject({ status: `ok` })
		if (eof.status === `ok`) expect(eof.leafIds).toHaveLength(1)

		const tooWide = await reader.resolveRange(
			{ end: 63, kind: `utf16-range`, start: 0 },
			2,
		)
		expect(tooWide).toEqual({
			recovery: {
				code: `range-resnapshot`,
				range: { end: 63, kind: `utf16-range`, start: 0 },
				reason: `range-member-limit`,
			},
			status: `resnapshot`,
		})
		if (tooWide.status === `resnapshot`) {
			const error = new MosaicTextIndexRangeRecoveryError(tooWide.recovery)
			expect(error.name).toBe(`MosaicTextIndexRangeRecoveryError`)
			expect(error.recovery).toEqual(tooWide.recovery)
		}
	})

	test(`retains hysteretic boundaries and writes one leaf plus its index path for a local edit`, () => {
		const before = createMosaicTextIndex([fragment(`a`.repeat(64))], compact)
		const leavesBefore = membersOf(before, `leaf`)
		const afterFragments = [
			fragment(`a`.repeat(18), `run`, 0),
			fragment(`XY`, `insert`, 0),
			fragment(`a`.repeat(46), `run`, 18),
		]
		const result = maintainMosaicTextIndex(before, afterFragments, compact)

		expect(result.maintenance).toMatchObject({
			history: `exclude`,
			kind: `maintenance`,
		})
		expect(result.counters.leavesWritten).toBe(1)
		expect(result.counters.nodesWritten).toBeLessThanOrEqual(3)
		expect(result.counters.rootWritten).toBe(1)
		expect(membersOf(result.index, `leaf`).length).toBe(leavesBefore.length)
		expect(
			result.counters.leavesWritten + result.counters.nodesWritten,
		).toBeLessThan(leavesBefore.length)

		const duplicate = maintainMosaicTextIndex(
			result.index,
			afterFragments,
			compact,
		)
		expect(duplicate.index).toBe(result.index)
		expect(duplicate.maintenance).toEqual({
			history: `exclude`,
			kind: `maintenance`,
			remove: [],
			root: null,
			upsert: [],
		})
	})

	test(`translates stale leaf residence across split and merge without changing logical anchors`, async () => {
		const splitOptions = { ...compact, targetLeafGraphemes: 8 }
		const before = createMosaicTextIndex(
			[fragment(`abcdefgh`, `run`)],
			splitOptions,
		)
		const staleLeaf = membersOf(before, `leaf`)[0]
		const anchor = {
			leafId: staleLeaf.id,
			position: { affinity: `right` as const, offset: 6, runId: `run` },
		}
		const collaborativeAnchors = {
			annotations: [{ end: anchor.position, start: anchor.position }],
			pendingProposals: [{ after: anchor.position, id: `alice:pending:1` }],
			presence: {
				selection: { anchor: anchor.position, head: anchor.position },
			},
		}
		const anchorsBeforeMaintenance = structuredClone(collaborativeAnchors)
		const split = maintainMosaicTextIndex(
			before,
			[
				fragment(`abcd`, `run`, 0),
				fragment(`0123456789`, `foreign`),
				fragment(`efgh`, `run`, 4),
			],
			splitOptions,
		)
		const alias = membersOf(split.index, `alias`).find(
			({ source }) => source === staleLeaf.id,
		)
		expect(alias?.targets?.length).toBeGreaterThan(1)
		const translation = await createMosaicTextIndexReader(
			mosaicTextIndexSource(split.index),
		).resolveAlias(anchor.leafId)
		expect(translation).toMatchObject({ status: `ok` })
		expect(anchor.position).toEqual({
			affinity: `right`,
			offset: 6,
			runId: `run`,
		})
		expect(collaborativeAnchors).toEqual(anchorsBeforeMaintenance)

		const merged = maintainMosaicTextIndex(
			split.index,
			[fragment(`abcdefgh`, `run`)],
			splitOptions,
		)
		expect(merged.index.root.reference?.summary.utf16Units).toBe(8)
		expect(mosaicTextIndexAliasKey(staleLeaf.id)).toMatch(/^alias:/)
	})

	test(`settles cross-leaf edits and maintenance as one history-safe Domain gesture`, () => {
		const before = createMosaicTextIndex([fragment(`abcdefghijkl`)], compact)
		const update = maintainMosaicTextIndex(
			before,
			[
				fragment(`abcd`, `run`, 0),
				fragment(`PASTE`, `paste`),
				fragment(`ijkl`, `run`, 8),
			],
			compact,
		)
		const gesture = composeMosaicTextIndexedGesture({
			gestureId: `alice:paste:1`,
			maintenance: update.maintenance,
			operations: [
				{ leaf: `left`, type: `delete` },
				{ leaf: `middle`, type: `insert` },
				{ leaf: `right`, type: `delete` },
			],
		})

		expect(gesture.gestureId).toBe(`alice:paste:1`)
		expect(gesture.operations).toHaveLength(3)
		expect(gesture.maintenance.history).toBe(`exclude`)
		expect(() =>
			composeMosaicTextIndexedGesture({
				gestureId: ``,
				maintenance: update.maintenance,
				operations: [],
			}),
		).toThrow(`gesture ID`)
	})

	test(`converges seeded clients across split, merge, offline replay, duplicates, reorder, and restart`, async () => {
		type Action = { readonly id: string; readonly present: boolean }
		type Fault = {
			readonly clientId: string
			readonly type: `duplicate` | `offline` | `reorder` | `restart`
		}
		const clientIds = [`alice`, `bob`, `carol`] as const
		const schedule = await RTT.runSeededModelScenario<Action, Fault>({
			actions: 24,
			clientIds,
			createRuntime: () => {
				const base = createMosaicTextIndex(
					[fragment(`abcdefgh`, `base`)],
					compact,
				)
				let authoritative = base
				let revision = 0
				const insertions = new Map<string, string>()
				const clients = new Map<
					string,
					{ index: MosaicTextIndexBundle; revision: number }
				>(
					clientIds.map((id) => [
						id,
						{ index: structuredClone(base), revision: 0 },
					]),
				)
				let nextFault: Fault | undefined
				let prior = structuredClone(base)
				const logical = (): MosaicTextIndexFragment[] => [
					fragment(`abcd`, `base`, 0),
					...[...insertions]
						.sort(([left], [right]) => left.localeCompare(right))
						.map(([id, text]) => fragment(text, id)),
					fragment(`efgh`, `base`, 4),
				]
				const deliver = (
					clientId: string,
					index: MosaicTextIndexBundle,
					deliveredRevision: number,
				): void => {
					const client = clients.get(clientId)!
					if (deliveredRevision <= client.revision) return
					client.index = structuredClone(index)
					client.revision = deliveredRevision
				}
				return {
					applyAction: (_clientId, action) => {
						if (action.present) insertions.set(action.id, action.id.at(-1)!)
						else insertions.delete(action.id)
						prior = authoritative
						authoritative = maintainMosaicTextIndex(
							authoritative,
							logical(),
							compact,
						).index
						revision++
						for (const clientId of clientIds) {
							if (
								nextFault?.type === `offline` &&
								nextFault.clientId === clientId
							) {
								continue
							}
							deliver(clientId, authoritative, revision)
							if (nextFault?.type === `duplicate`) {
								deliver(clientId, authoritative, revision)
							} else if (nextFault?.type === `reorder`) {
								deliver(clientId, prior, revision - 1)
							}
						}
						nextFault = undefined
					},
					applyFault: (fault) => {
						if (fault.type === `restart`) {
							authoritative = structuredClone(authoritative)
						} else nextFault = fault
					},
					assertInvariants: () => {
						for (const client of clients.values()) {
							expect(client.index).toEqual(authoritative)
							expect(client.revision).toBe(revision)
						}
						for (const leaf of membersOf(authoritative, `leaf`)) {
							expect(leaf.summary.graphemes).toBeLessThanOrEqual(
								compact.maximumLeafGraphemes,
							)
						}
					},
					quiesce: () => {
						// An offline client's bounded resnapshot/replay catches the current cut.
						for (const clientId of clientIds) {
							deliver(clientId, authoritative, revision)
						}
					},
				}
			},
			faults: 12,
			generateAction: ({ clientId, index, random }) => ({
				id: `${clientId}:${random.integer(4)}`,
				present: index % 3 !== 0,
			}),
			generateFault: ({ clientIds: availableClientIds, random }) => ({
				clientId: random.pick(availableClientIds),
				type: random.pick([
					`duplicate`,
					`offline`,
					`reorder`,
					`restart`,
				] as const),
			}),
			seed: 0x15_15,
		})
		expect(schedule.steps).toHaveLength(36)
	})

	test(`indexes MOS-14 checkpoints and remains ordinary atom-family Domain state`, async () => {
		const Markdown = mosaicText({ initialText: `one\ntwo` })
		const document = new Markdown()
		const fragments = mosaicTextIndexFragments(document.toJSON())
		const index = createMosaicTextIndex(fragments, compact)
		expect(index.root.reference?.summary.lineBreaks).toBe(1)

		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `text-index-domain`,
		})
		type StoredIndexMember = { readonly value: MosaicTextIndexMember }
		const indexAtoms = silo.atomFamily<StoredIndexMember, string>({
			default: { value: membersOf(index, `leaf`)[0] },
			key: `index`,
		})
		const definition = mosaicDomain({
			configSchema: z.object({}),
			key: `indexed-text-test`,
			members: {
				textIndex: {
					keySchema: z.string().min(1),
					role: `durable`,
					schema: z.object({ value: z.custom<MosaicTextIndexMember>() }),
					token: indexAtoms,
				},
			},
			version: 1,
		})
		const domain = await definition.activate({
			config: {},
			instance: `document`,
			store: silo.store,
		})
		expect(domain.address(`textIndex`, index.members[0].id)).toMatchObject({
			member: `textIndex`,
		})
		domain[Symbol.dispose]()
	})

	test(`fails closed on invalid bounds, fragments, reads, and ranges`, async () => {
		expect(() =>
			createMosaicTextIndex([fragment(`a`)], {
				...compact,
				minimumLeafGraphemes: 9,
			}),
		).toThrow(`Leaf sizes`)
		expect(() =>
			createMosaicTextIndex([fragment(`a`)], {
				...compact,
				minimumChildrenPerNode: 5,
			}),
		).toThrow(`Node sizes`)
		expect(() =>
			createMosaicTextIndex([fragment(`a`)], {
				...compact,
				maximumAliasTargets: 0,
			}),
		).toThrow(`maximumAliasTargets`)
		expect(() =>
			createMosaicTextIndex([
				fragment(`a`, `same`, 0),
				fragment(`b`, `same`, 0),
			]),
		).toThrow(`Duplicate logical`)
		expect(() =>
			createMosaicTextIndex([{ runId: `run`, start: 0, text: `` }]),
		).toThrow(`Invalid Mosaic text index fragment`)
		expect(() =>
			createMosaicTextIndex([fragment(`👨‍👩‍👧‍👦`)], {
				...compact,
				maximumLeafUtf16Units: 2,
			}),
		).toThrow(`grapheme`)

		const index = createMosaicTextIndex([fragment(`abcd`)], compact)
		const reader = createMosaicTextIndexReader(mosaicTextIndexSource(index))
		await expect(reader.positionAtOffset(4)).resolves.toMatchObject({
			globalUtf16: 4,
		})
		await expect(reader.positionAtLine(0)).resolves.toMatchObject({
			globalLine: 0,
		})
		await expect(reader.positionAtOffset(5)).rejects.toThrow(`outside`)
		await expect(
			reader.resolveRange({ end: 2, kind: `utf16-range`, start: 3 }, 1),
		).rejects.toThrow(`Invalid`)
		await expect(
			reader.resolveAlias(`missing`, {
				end: 4,
				kind: `utf16-range`,
				start: 2,
			}),
		).resolves.toEqual({
			recovery: {
				code: `range-resnapshot`,
				range: { end: 4, kind: `utf16-range`, start: 2 },
				reason: `alias-missing`,
			},
			status: `resnapshot`,
		})
		await expect(
			reader.resolveAlias(`missing`, {
				end: 1,
				kind: `utf16-range`,
				start: 2,
			}),
		).rejects.toThrow(`Invalid Mosaic text index range`)

		const empty = createMosaicTextIndex([])
		const emptyReader = createMosaicTextIndexReader(mosaicTextIndexSource(empty))
		await expect(emptyReader.positionAtOffset(0)).rejects.toThrow(
			`index is empty`,
		)
		await expect(
			emptyReader.resolveRange({ end: 0, kind: `utf16-range`, start: 0 }, 1),
		).resolves.toEqual({ leafIds: [], status: `ok` })
		const invalidRoot = createMosaicTextIndexReader({
			read: () => Promise.resolve(undefined),
			root: () => Promise.resolve({ ...empty.root, kind: `invalid` } as never),
		})
		await expect(invalidRoot.positionAtOffset(0)).rejects.toThrow(`Invalid`)

		const zeroSummary = {
			graphemes: 0,
			leafCount: 0,
			lineBreaks: 0,
			utf16Units: 0,
		}
		const emptyNodeRoot: MosaicTextIndexRoot = {
			generation: 0,
			id: `root`,
			kind: `root`,
			reference: { id: `empty-node`, kind: `node`, summary: zeroSummary },
			version: 1,
		}
		const emptyNodeReader = createMosaicTextIndexReader({
			read: () =>
				Promise.resolve({
					children: [],
					id: `empty-node`,
					kind: `node`,
					level: 1,
					summary: zeroSummary,
					version: 1,
				}),
			root: () => Promise.resolve(emptyNodeRoot),
		})
		await expect(emptyNodeReader.positionAtOffset(0)).rejects.toThrow(
			`Empty Mosaic text index node`,
		)
		const nested = createMosaicTextIndex([fragment(`a`.repeat(64))], compact)
		const nestedRootReference = nested.root.reference!
		const nestedLeaf = membersOf(nested, `leaf`)[0]
		const wrongNodeReader = createMosaicTextIndexReader({
			read: (id) => Promise.resolve({ ...nestedLeaf, id }),
			root: () => Promise.resolve(nested.root),
		})
		await expect(wrongNodeReader.positionAtOffset(1)).rejects.toThrow(
			`reference kind mismatch`,
		)
		await expect(
			wrongNodeReader.resolveRange({ end: 2, kind: `utf16-range`, start: 1 }, 2),
		).rejects.toThrow(`reference kind mismatch`)
		expect(nestedRootReference.kind).toBe(`node`)

		const wrongLeafReader = createMosaicTextIndexReader({
			read: (id) =>
				Promise.resolve({
					children: [],
					id,
					kind: `node`,
					level: 1,
					summary: index.root.reference!.summary,
					version: 1,
				}),
			root: () => Promise.resolve(index.root),
		})
		await expect(wrongLeafReader.positionAtOffset(1)).rejects.toThrow(
			`reference kind mismatch`,
		)
		const firstLeaf = membersOf(index, `leaf`)[0]
		const staleMemberReader = createMosaicTextIndexReader({
			read: (id) => Promise.resolve({ ...firstLeaf, id, version: 2 } as never),
			root: () => Promise.resolve(index.root),
		})
		await expect(staleMemberReader.positionAtOffset(1)).rejects.toThrow(
			`Missing Mosaic text index member`,
		)

		const mismatchedAliasReader = createMosaicTextIndexReader({
			read: (id) => Promise.resolve({ ...firstLeaf, id }),
			root: () => Promise.resolve(index.root),
		})
		await expect(mismatchedAliasReader.resolveAlias(`stale`)).rejects.toThrow(
			`alias mismatch`,
		)
	})

	test(`bounds alias fanout and retains structured stale recovery metadata`, async () => {
		const options = {
			...compact,
			maximumAliasTargets: 1,
			targetLeafGraphemes: 8,
		}
		const base = createMosaicTextIndex([fragment(`abcdefgh`, `base`)], options)
		const staleId = membersOf(base, `leaf`)[0].id
		const split = maintainMosaicTextIndex(
			base,
			[
				fragment(`abcd`, `base`, 0),
				fragment(`0123456789`, `insert`),
				fragment(`efgh`, `base`, 4),
			],
			options,
		)
		const firstRecovery = await createMosaicTextIndexReader(
			mosaicTextIndexSource(split.index),
		).resolveAlias(staleId)
		expect(firstRecovery).toMatchObject({
			recovery: { reason: `alias-fanout` },
			status: `resnapshot`,
		})

		const retained = maintainMosaicTextIndex(
			split.index,
			[
				fragment(`abcd`, `base`, 0),
				fragment(`0123456789!`, `insert`),
				fragment(`efgh`, `base`, 4),
			],
			options,
		)
		expect(
			membersOf(retained.index, `alias`).find(({ source }) => source === staleId)
				?.recovery,
		).toMatchObject({ reason: `alias-fanout` })
	})
})
