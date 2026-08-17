import {
	atom,
	findState,
	getState,
	mutableAtom,
	mutableAtomFamily,
	runTransaction,
	scopeFamily,
	selector,
	setState,
	timeline,
	timelineFamily,
	transaction,
} from "atom.io"
import {
	compareMosaicIds,
	createEmptyMosaicText,
	deriveMosaicTextHistory,
	exportMosaicTextSegments,
	importMosaicTextSegments,
	materializeMosaicText,
	MOSAIC_PROTOCOL_VERSION,
	mosaicAtomAddress,
	mosaicAtomAddressKey,
	type MosaicOperationSignal,
	type MosaicPrepareContext,
	type MosaicReduceContext,
	mosaicText,
	type MosaicTextIntent,
	type MosaicTextOperation,
	type MosaicTextSegmentBundle,
	resolveMosaicTextPosition,
	splitMosaicText,
	visibleMosaicTextRuns,
} from "atom.io/realtime"
import { takeSnapshot } from "atom.io/testing"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
})

function context(
	id: string,
	actor: string,
	gestureId = id,
	dependencies: readonly string[] = [],
): MosaicPrepareContext {
	return {
		actor,
		dependencies,
		group: gestureId,
		id,
		now: 10,
		revision: null,
		session: `${actor}:tab`,
	}
}

function change(
	document: InstanceType<ReturnType<typeof mosaicText>>,
	intent: MosaicTextIntent,
	metadata: MosaicPrepareContext,
): MosaicOperationSignal<MosaicTextOperation> {
	const signal = document.change(intent, metadata)
	if (signal === null) throw new Error(`Expected a Mosaic signal`)
	return signal
}

function accepted(
	signal: MosaicOperationSignal<MosaicTextOperation>,
	revision: number,
): MosaicOperationSignal<MosaicTextOperation> {
	return { ...signal, revision }
}

describe(`Mosaic run-text transceiver`, () => {
	test(`is an ordinary addressed mutable atom with append-only history`, () => {
		const Markdown = mosaicText({ initialText: `Seed` })
		const markdownAtom = mutableAtom<InstanceType<typeof Markdown>>({
			key: `markdown`,
			class: Markdown,
		})
		const address = mosaicAtomAddress(markdownAtom)
		expect(address).toEqual({ key: `markdown`, type: `mutable_atom` })
		expect(mosaicAtomAddressKey(address)).toBe(
			`["mutable_atom","markdown",null,null]`,
		)
		expect(Markdown.mosaic).toEqual({
			configuration: {
				initialText: `Seed`,
				maximumDeletionIntervalsPerOperation: 16_384,
				maximumHistoryTargets: 10_000,
				maximumRunGraphemes: 200_000,
				maximumRunUtf16Units: 4_000_000,
				maximumRunsPerOperation: 16,
			},
			key: `text`,
			version: 2,
		})
		expect(Markdown.timelinePolicy).toBe(`append-only`)
		expect(MOSAIC_PROTOCOL_VERSION).toBe(1)
		expect(() =>
			timeline({ key: `unsafeDocumentHistory`, scope: [markdownAtom] }),
		).toThrow(`append-only`)
		const documentsAtoms = mutableAtomFamily<
			InstanceType<typeof Markdown>,
			string
		>({ key: `documents`, class: Markdown })
		const documentAtom = findState(documentsAtoms, `guide`)
		expect(mosaicAtomAddress(documentAtom)).toEqual({
			family: { key: `documents`, subKey: `"guide"` },
			key: `documents("guide")`,
			type: `mutable_atom`,
		})
		expect(() =>
			timelineFamily({
				key: `unsafeDocumentHistories`,
				scope: [scopeFamily(documentsAtoms, { timelineKey: (key) => key })],
			}),
		).toThrow(`append-only`)
		const ordinaryAtom = atom<number>({ key: `ordinary`, default: 0 })
		expect(() =>
			timeline({
				key: `mixedUnsafeHistory`,
				scope: [ordinaryAtom, markdownAtom],
			}),
		).toThrow(`append-only`)
		expect(() =>
			timeline({ key: `ordinaryHistory`, scope: [ordinaryAtom] }),
		).not.toThrow()
	})

	test(`participates in selectors and rolls back with transactions`, () => {
		const Markdown = mosaicText({ initialText: `A` })
		const markdownAtom = mutableAtom<InstanceType<typeof Markdown>>({
			key: `markdown`,
			class: Markdown,
		})
		const lengthSelector = selector<number>({
			key: `length`,
			get: ({ get }) => get(markdownAtom).length,
		})
		setState(markdownAtom, (document) => {
			document.change(
				{ text: `ABC`, type: `replace-text` },
				context(`alice:1`, `alice`),
			)
			return document
		})
		expect(getState(markdownAtom).text).toBe(`ABC`)
		expect(getState(lengthSelector)).toBe(3)

		const failedTransaction = transaction({
			key: `failed`,
			do: ({ set }) => {
				set(markdownAtom, (document) => {
					document.change(
						{ text: `discard me`, type: `replace-text` },
						context(`alice:2`, `alice`),
					)
					return document
				})
				throw new Error(`abort`)
			},
		})
		expect(() => runTransaction(failedTransaction)()).toThrow(`abort`)
		expect(getState(markdownAtom).text).toBe(`ABC`)
		expect(getState(lengthSelector)).toBe(3)
	})

	test(`emits complete signals and checkpoints combining marks and ZWJ emoji`, () => {
		const Markdown = mosaicText({ initialText: `A` })
		const document = new Markdown()
		let observed: MosaicOperationSignal<MosaicTextOperation> | null = null
		document.subscribe(`test`, (signal) => {
			observed = signal
		})
		const signal = change(
			document,
			{ text: `A👨‍👩‍👧‍👦é`, type: `replace-text` },
			context(`alice:1`, `alice`),
		)
		expect(observed).toEqual(signal)
		expect(signal.operation).toMatchObject({
			deleted: [],
			inserted: [{ text: `👨‍👩‍👧‍👦é` }],
			type: `edit`,
		})
		expect(document.text).toBe(`A👨‍👩‍👧‍👦é`)
		const snapshot = document.toJSON()
		expect(snapshot.runs).toHaveLength(2)
		expect(
			snapshot.runs.find(({ createdBy }) => createdBy === signal.id)?.graphemes,
		).toBe(2)
		const clone = Markdown.fromJSON(snapshot)
		expect(clone.text).toBe(document.text)
		expect(clone).not.toBe(document)
		expect(() => {
			clone.undo(signal)
		}).toThrow(`append-only`)
	})

	test(`uses deterministic Unicode primitives and bounded model limits`, () => {
		expect(splitMosaicText(`👨‍👩‍👧‍👦é`)).toEqual([`👨‍👩‍👧‍👦`, `é`])
		expect(compareMosaicIds(`a`, `b`)).toBe(-1)
		expect(compareMosaicIds(`b`, `a`)).toBe(1)
		expect(compareMosaicIds(`same`, `same`)).toBe(0)
		expect(createEmptyMosaicText()).toEqual({
			actions: [],
			runs: [],
			version: 2,
		})
		expect(() => mosaicText({ maximumRunGraphemes: 0 })).toThrow(
			`maximumRunGraphemes must be a positive bounded safe integer`,
		)
		expect(() => mosaicText({ maximumRunGraphemes: 1.5 })).toThrow(
			`maximumRunGraphemes must be a positive bounded safe integer`,
		)
		expect(() =>
			mosaicText({ maximumGraphemes: 2, maximumRunGraphemes: 3 }),
		).toThrow(`must agree`)
		const SplitSeed = mosaicText({
			initialText: `abcd`,
			maximumRunGraphemes: 1,
		})
		expect(new SplitSeed().toJSON().runs).toHaveLength(4)
	})

	test(`stores an enormous insertion as one durable run`, () => {
		const largeText = `a`.repeat(200_000)
		const Markdown = mosaicText()
		const document = new Markdown()
		change(
			document,
			{ text: largeText, type: `replace-text` },
			context(`alice:large`, `alice`),
		)
		expect(document.text).toBe(largeText)
		expect(document.runs).toHaveLength(1)
		expect(document.toJSON().runs).toHaveLength(1)
		expect(document.toJSON().runs[0].fragments).toHaveLength(1)
	})

	test(`bounds each run and operation without imposing a document cap`, () => {
		const Text = mosaicText({
			initialText: `ab`,
			maximumRunGraphemes: 2,
			maximumRunsPerOperation: 1,
		})
		const document = new Text()
		change(
			document,
			{ text: `abcd`, type: `replace-text` },
			context(`alice:1`, `alice`),
		)
		change(
			document,
			{ text: `abcdef`, type: `replace-text` },
			context(`alice:2`, `alice`, `alice:2`, [`alice:1`]),
		)
		expect(document.text).toBe(`abcdef`)
		expect(document.toJSON().runs).toHaveLength(3)
		expect(() =>
			document.change(
				{ text: `${document.text}xyz`, type: `replace-text` },
				context(`alice:3`, `alice`),
			),
		).toThrow(`maximumRunsPerOperation`)
	})

	test(`concurrent inserted runs converge without grapheme interleaving`, () => {
		const Markdown = mosaicText({ initialText: `A` })
		const base = new Markdown().toJSON()
		const alice = Markdown.fromJSON(base)
		const bob = Markdown.fromJSON(base)
		const aliceSignal = accepted(
			change(
				alice,
				{ text: `A[ALICE]`, type: `replace-text` },
				context(`alice:operation:1`, `alice`, `alice:gesture`),
			),
			1,
		)
		const bobSignal = accepted(
			change(
				bob,
				{ text: `A[BOB]`, type: `replace-text` },
				context(`bob:operation:1`, `bob`, `bob:gesture`),
			),
			2,
		)
		const aliceThenBob = Markdown.fromJSON(base)
		aliceThenBob.do(aliceSignal)
		aliceThenBob.do(bobSignal)
		const bobThenAlice = Markdown.fromJSON(base)
		bobThenAlice.do(bobSignal)
		bobThenAlice.do(aliceSignal)
		expect(aliceThenBob.text).toBe(bobThenAlice.text)
		expect(aliceThenBob.text).toContain(`[ALICE]`)
		expect(aliceThenBob.text).toContain(`[BOB]`)
		expect(aliceThenBob.text).not.toContain(`[A[`)
	})

	test(`concurrent delete and replace contention converges`, () => {
		const Markdown = mosaicText({ initialText: `abc` })
		const base = new Markdown().toJSON()
		const alice = Markdown.fromJSON(base)
		const bob = Markdown.fromJSON(base)
		const replace = accepted(
			change(
				alice,
				{ text: `aXc`, type: `replace-text` },
				context(`alice:replace`, `alice`),
			),
			1,
		)
		const remove = accepted(
			change(
				bob,
				{ text: `ac`, type: `replace-text` },
				context(`bob:delete`, `bob`),
			),
			2,
		)
		const forward = Markdown.fromJSON(base)
		forward.do(replace)
		forward.do(remove)
		const reverse = Markdown.fromJSON(base)
		reverse.do(remove)
		reverse.do(replace)
		expect(forward.text).toBe(`aXc`)
		expect(reverse.toJSON()).toEqual(forward.toJSON())
	})

	test(`bounds middle replacements before their retained suffix`, () => {
		const Markdown = mosaicText({ initialText: `abc` })
		const document = new Markdown()
		change(
			document,
			{ text: `aXc`, type: `replace-text` },
			context(`zoe:operation:1`, `zoe`),
		)
		expect(document.text).toBe(`aXc`)
		const operation = document.toJSON().actions.at(-1)?.operation
		expect(operation).toMatchObject({
			deleted: [{ end: 2, start: 1 }],
			insertedRunIds: [`zoe:operation:1:run:000000`],
		})
	})

	test(`selective gesture history preserves foreign descendants`, () => {
		const Markdown = mosaicText({ initialText: `Seed` })
		const document = new Markdown()
		const jane = change(
			document,
			{ text: `Seed[Jane]`, type: `replace-text` },
			context(`jane:1`, `jane`, `domain:gesture:jane-typing`),
		)
		const dave = change(
			document,
			{ text: `Seed[Jane][Dave]`, type: `replace-text` },
			context(`dave:1`, `dave`, `domain:gesture:dave-typing`, [jane.id]),
		)
		expect(document.historyFor(`jane`).undo.at(-1)).toEqual({
			gestureId: `domain:gesture:jane-typing`,
			targetOperationIds: [jane.id],
		})
		const undo = change(
			document,
			{ type: `undo` },
			context(`jane:2`, `jane`, `domain:gesture:jane-undo`, [dave.id]),
		)
		expect(document.text).toBe(`Seed[Dave]`)
		expect(document.historyFor(`jane`).redo).toHaveLength(1)
		change(
			document,
			{ type: `redo` },
			context(`jane:3`, `jane`, `domain:gesture:jane-redo`, [undo.id]),
		)
		expect(document.text).toBe(`Seed[Jane][Dave]`)
	})

	test(`groups edits by Domain gesture and closes stale history`, () => {
		const Markdown = mosaicText({ initialText: `A` })
		const document = new Markdown()
		change(
			document,
			{ text: `AB`, type: `replace-text` },
			context(`alice:1`, `alice`, `domain:gesture:typing`),
		)
		change(
			document,
			{ text: `ABC`, type: `replace-text` },
			context(`alice:2`, `alice`, `domain:gesture:typing`),
		)
		expect(document.historyFor(`alice`).undo.at(-1)).toEqual({
			gestureId: `domain:gesture:typing`,
			targetOperationIds: [`alice:1`, `alice:2`],
		})
		const reduceContext: MosaicReduceContext = {
			...context(`alice:3`, `alice`),
			revision: null,
		}
		expect(
			document.validate(
				{
					mode: `undo`,
					targetOperationIds: [`not-the-top`],
					type: `history`,
				},
				reduceContext,
			),
		).toEqual({
			code: `stale-history`,
			reason: `The actor history cursor is stale.`,
			recovery: `resnapshot`,
			status: `reject`,
		})
	})

	test(`validates malformed runs, boundaries, intervals, and operation bounds`, () => {
		const Markdown = mosaicText({
			initialText: `ab`,
			maximumDeletionIntervalsPerOperation: 2,
			maximumRunGraphemes: 2,
			maximumRunsPerOperation: 1,
		})
		const document = new Markdown()
		const metadata: MosaicReduceContext = {
			...context(`alice:1`, `alice`),
			revision: null,
		}
		const seed = document.toJSON().runs[0]
		const runId = `${metadata.id}:run:000000`
		const edit = (overrides: Record<string, unknown> = {}) => ({
			deleted: [],
			inserted: [
				{
					after: { offset: 1, runId: seed.id },
					before: { offset: 1, runId: seed.id },
					id: runId,
					text: `X`,
				},
			],
			type: `edit`,
			...overrides,
		})
		expect(document.validate(null, metadata)).toEqual({
			reason: `Operation must be an object.`,
			status: `reject`,
		})
		expect(document.validate({ type: `edit` }, metadata)).toEqual({
			reason: `Malformed text edit.`,
			status: `reject`,
		})
		expect(document.validate(edit({ inserted: [null] }), metadata)).toEqual({
			reason: `Malformed inserted run.`,
			status: `reject`,
		})
		expect(
			document.validate(
				edit({ inserted: [{ ...edit().inserted[0], text: `XYZ` }] }),
				metadata,
			),
		).toEqual({
			reason: `Inserted run exceeds its grapheme bound.`,
			status: `reject`,
		})
		expect(
			document.validate(
				edit({
					inserted: [
						{
							...edit().inserted[0],
							text: `e${`́`.repeat(1_024)}`,
						},
					],
				}),
				metadata,
			),
		).toEqual({
			reason: `Inserted run exceeds its grapheme bound.`,
			status: `reject`,
		})
		expect(
			document.validate(
				edit({
					inserted: [
						{
							...edit().inserted[0],
							after: { offset: 0, runId: `missing` },
						},
					],
				}),
				{ ...metadata, dependencies: [`future`] },
			),
		).toEqual({ dependencies: [`future`], status: `defer` })
		expect(
			document.validate(
				edit({
					inserted: [
						{
							...edit().inserted[0],
							after: { offset: 3, runId: seed.id },
						},
					],
				}),
				metadata,
			),
		).toEqual({ reason: `Run boundary is out of range.`, status: `reject` })
		expect(
			document.validate(
				edit({
					inserted: [
						{
							...edit().inserted[0],
							after: { offset: 2, runId: seed.id },
							before: { offset: 1, runId: seed.id },
						},
					],
				}),
				metadata,
			),
		).toEqual({
			reason: `The insertion interval is inverted.`,
			status: `reject`,
		})
		expect(
			document.validate(
				edit({
					deleted: [{ end: 1, runId: seed.id, start: 1 }],
					inserted: [],
				}),
				metadata,
			),
		).toEqual({
			reason: `Deletion interval is out of range.`,
			status: `reject`,
		})
		expect(
			document.validate(
				edit({
					deleted: [{ end: 1, runId: `missing`, start: 0 }],
					inserted: [],
				}),
				metadata,
			),
		).toEqual({ reason: `Unknown deletion run.`, status: `reject` })
		expect(
			document.validate(
				{ mode: `undo`, targetOperationIds: [], type: `history` },
				metadata,
			),
		).toEqual({ reason: `Malformed history operation.`, status: `reject` })
		expect(document.validate({ type: `mystery` }, metadata)).toEqual({
			reason: `Unknown text operation type.`,
			status: `reject`,
		})
	})

	test(`compacts adjacent and overlapping deletion targets`, () => {
		const Markdown = mosaicText({ initialText: `abcd` })
		const document = new Markdown()
		const seed = document.toJSON().runs[0]
		const metadata: MosaicReduceContext = {
			...context(`alice:delete`, `alice`),
			revision: null,
		}
		const decision = document.validate(
			{
				deleted: [
					{ end: 2, runId: seed.id, start: 0 },
					{ end: 4, runId: seed.id, start: 1 },
				],
				inserted: [],
				type: `edit`,
			},
			metadata,
		)
		expect(decision).toEqual({
			operation: {
				deleted: [{ end: 4, runId: seed.id, start: 0 }],
				inserted: [],
				type: `edit`,
			},
			status: `accept`,
		})
	})

	test(`waits for the unresolved causal frontier before rejecting run IDs`, () => {
		const Markdown = mosaicText()
		const document = new Markdown()
		const proposalContext: MosaicReduceContext = {
			...context(`carol:delete`, `carol`, `carol:delete`, [`bob:bridge`]),
			revision: null,
		}
		const proposal = {
			deleted: [{ end: 1, runId: `alice:create:run:000000`, start: 0 }],
			inserted: [],
			type: `edit`,
		}
		expect(document.validate(proposal, proposalContext)).toEqual({
			dependencies: [`bob:bridge`],
			status: `defer`,
		})
		document.do({
			actor: `alice`,
			dependencies: [],
			group: `alice:create`,
			id: `alice:create`,
			operation: {
				deleted: [],
				inserted: [
					{
						after: null,
						before: null,
						id: `alice:create:run:000000`,
						text: `A`,
					},
				],
				type: `edit`,
			},
			revision: 1,
			session: `alice:tab`,
		})
		document.do({
			actor: `bob`,
			dependencies: [`alice:create`],
			group: `bob:bridge`,
			id: `bob:bridge`,
			operation: { deleted: [], inserted: [], type: `edit` },
			revision: 2,
			session: `bob:tab`,
		})
		expect(document.validate(proposal, proposalContext)).toMatchObject({
			status: `accept`,
		})
	})

	test(`rejects collisions and hydrates only validated compact history`, () => {
		const Markdown = mosaicText({ initialText: `A` })
		const document = new Markdown()
		const signal = change(
			document,
			{ text: `AB`, type: `replace-text` },
			context(`alice:1`, `alice`),
		)
		expect(() =>
			document.do({
				...signal,
				operation: { deleted: [], inserted: [], type: `edit` },
			}),
		).toThrow(`Mosaic operation id collision`)
		const snapshot = document.toJSON()
		expect(Markdown.fromJSON(snapshot).text).toBe(`AB`)
		expect(() => Markdown.fromJSON(null as never)).toThrow(
			`Invalid Mosaic text snapshot`,
		)
		expect(() =>
			Markdown.fromJSON({ ...snapshot, runs: [snapshot.runs[0]] }),
		).toThrow(`checkpoint run ownership`)
		expect(() =>
			Markdown.fromJSON({
				...snapshot,
				runs: snapshot.runs.map((run, index) =>
					index === 0 ? { ...run, fragments: [{ start: 1, text: `A` }] } : run,
				),
			}),
		).toThrow(`checkpoint fragments`)
	})

	test(`run-relative positions survive deletion, checkpointing, and affinity`, () => {
		const Markdown = mosaicText({ initialText: `abc` })
		const document = new Markdown()
		const position = document.positionAtOffset(2)
		expect(position).toMatchObject({ offset: 2, runId: expect.any(String) })
		expect(document.resolvePosition(position)).toBe(2)
		const selection = document.selectionFromOffsets(1, 3)
		change(
			document,
			{ text: `ac`, type: `replace-text` },
			context(`alice:delete`, `alice`),
		)
		expect(document.resolvePosition(position)).toBe(1)
		const restored = Markdown.fromJSON(document.toJSON())
		expect(restored.resolvePosition(selection.anchor)).toBe(1)
		expect(materializeMosaicText(restored.toJSON())).toBe(`ac`)
		expect(
			deriveMosaicTextHistory(restored.toJSON(), `alice`).undo,
		).toHaveLength(1)
		expect(
			resolveMosaicTextPosition(restored.toJSON(), {
				affinity: `left`,
				offset: 0,
				runId: `unknown`,
			}),
		).toBe(0)

		const Affinity = mosaicText({ initialText: `ab` })
		const affinity = new Affinity()
		const boundary = affinity.positionAtOffset(1)
		const left = { ...boundary, affinity: `left` as const }
		const right = { ...boundary, affinity: `right` as const }
		change(
			affinity,
			{ text: `aXb`, type: `replace-text` },
			context(`bob:insert`, `bob`),
		)
		expect(affinity.resolvePosition(left)).toBe(1)
		expect(affinity.resolvePosition(right)).toBe(2)

		const Emoji = mosaicText({ initialText: `😀a` })
		const emoji = new Emoji()
		const interior = emoji.positionAtOffset(1)
		expect(interior.affinity).toBe(`left`)
		expect(emoji.resolvePosition(interior)).toBe(2)
		const Empty = mosaicText()
		const empty = new Empty()
		expect(empty.positionAtOffset(0)).toEqual({
			affinity: `left`,
			offset: 0,
			runId: null,
		})
	})

	test(`split export and reordered duplicate import preserve logical identity`, () => {
		const Markdown = mosaicText({ initialText: `a👨‍👩‍👧‍👦ébcdef` })
		const document = new Markdown()
		const position = document.positionAtOffset(4)
		change(
			document,
			{ text: `a👨‍👩‍👧‍👦ébXdef`, type: `replace-text` },
			context(`alice:replace`, `alice`, `domain:gesture:replace`),
		)
		const before = document.toJSON()
		const bundle = exportMosaicTextSegments(before, {
			maximumFragmentsPerSegment: 2,
			maximumGraphemesPerSegment: 2,
		})
		expect(bundle.segments.length).toBeGreaterThan(1)
		expect(
			bundle.segments.every(
				(segment) =>
					segment.fragments.length <= 2 &&
					segment.fragments.reduce(
						(total, fragment) => total + splitMosaicText(fragment.text).length,
						0,
					) <= 2,
			),
		).toBe(true)
		const reordered: MosaicTextSegmentBundle = {
			manifest: bundle.manifest,
			segments: [
				...bundle.segments.toReversed(),
				structuredClone(bundle.segments[0]),
			],
		}
		const imported = importMosaicTextSegments(reordered)
		const restored = Markdown.fromJSON(imported)
		expect(restored.text).toBe(document.text)
		expect(restored.resolvePosition(position)).toBe(
			document.resolvePosition(position),
		)
		expect(imported.actions).toEqual(before.actions)
		expect(imported.runs.map(({ id }) => id)).toEqual(
			before.runs.map(({ id }) => id),
		)
		expect(imported.runs.some(({ fragments }) => fragments.length > 1)).toBe(
			true,
		)

		expect(() =>
			importMosaicTextSegments({
				...bundle,
				segments: bundle.segments.slice(1),
			}),
		).toThrow(`Missing Mosaic text physical segment`)
		expect(() =>
			importMosaicTextSegments({
				...bundle,
				segments: [
					...bundle.segments,
					{
						...bundle.segments[0],
						fragments: [{ ...bundle.segments[0].fragments[0], text: `poison` }],
					},
				],
			}),
		).toThrow(`Conflicting Mosaic text physical segment`)
	})

	test(`accepted revisions replay idempotently and converge under reordering`, () => {
		const Markdown = mosaicText()
		const base = new Markdown().toJSON()
		const alice = Markdown.fromJSON(base)
		const bob = Markdown.fromJSON(base)
		const carol = Markdown.fromJSON(base)
		const aliceSignal = accepted(
			change(
				alice,
				{ text: `ALICE`, type: `replace-text` },
				context(`alice:1`, `alice`),
			),
			1,
		)
		const bobSignal = accepted(
			change(
				bob,
				{ text: `BOB`, type: `replace-text` },
				context(`bob:1`, `bob`),
			),
			2,
		)
		const carolSignal = accepted(
			change(
				carol,
				{ text: `CAROL`, type: `replace-text` },
				context(`carol:1`, `carol`),
			),
			3,
		)
		const permutations = [
			[aliceSignal, bobSignal, carolSignal],
			[aliceSignal, carolSignal, bobSignal],
			[bobSignal, aliceSignal, carolSignal],
			[bobSignal, carolSignal, aliceSignal],
			[carolSignal, aliceSignal, bobSignal],
			[carolSignal, bobSignal, aliceSignal],
		]
		const replicas = permutations.map((signals) => {
			const replica = Markdown.fromJSON(base)
			for (const signal of signals) replica.do(signal)
			replica.do(signals[0])
			return replica
		})
		const canonical = replicas[0].toJSON()
		for (const replica of replicas) {
			expect(replica.toJSON()).toEqual(canonical)
		}
		expect(canonical.actions.map(({ revision }) => revision)).toEqual([1, 2, 3])
	})

	test(`checkpoint storage stays substantially below the grapheme-node reference`, () => {
		const graphemeCount = 50_000
		const text = `x`.repeat(graphemeCount)
		const Markdown = mosaicText()
		const document = new Markdown()
		change(
			document,
			{ text, type: `replace-text` },
			context(`alice:benchmark`, `alice`),
		)
		const checkpoint = document.toJSON()
		const referenceNodes = Array.from({ length: graphemeCount }, (_, index) => ({
			after: index === 0 ? null : `operation:node:${index - 1}`,
			before: null,
			createdBy: `operation`,
			id: `operation:node:${index}`,
			value: `x`,
		}))
		const checkpointBytes = Buffer.byteLength(JSON.stringify(checkpoint))
		const referenceBytes = Buffer.byteLength(JSON.stringify(referenceNodes))
		const durableRunObjects =
			checkpoint.runs.length +
			checkpoint.runs.reduce((total, run) => total + run.fragments.length, 0)

		expect(durableRunObjects).toBeLessThan(graphemeCount / 1_000)
		expect(checkpointBytes).toBeLessThan(referenceBytes * 0.1)
		expect(visibleMosaicTextRuns(checkpoint)).toHaveLength(1)
	})
})
