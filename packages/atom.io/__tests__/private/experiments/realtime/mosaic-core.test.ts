import {
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
	type MosaicTextSnapshot,
	resolveMosaicTextPosition,
	splitMosaicText,
} from "atom.io/realtime"
import { takeSnapshot } from "atom.io/testing"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
})

function context(
	id: string,
	actor: string,
	group = id,
	dependencies: readonly string[] = [],
): MosaicPrepareContext {
	return {
		actor,
		dependencies,
		group,
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

describe(`Mosaic text transceiver`, () => {
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
		expect(Markdown.mosaic).toEqual({ key: `text`, version: 1 })
		expect(Markdown.timelinePolicy).toBe(`append-only`)
		expect(MOSAIC_PROTOCOL_VERSION).toBe(1)
		expect(() =>
			timeline({ key: `unsafeDocumentHistory`, scope: [markdownAtom] }),
		).toThrow(`append-only`)
		const documentsAtoms = mutableAtomFamily<
			InstanceType<typeof Markdown>,
			string
		>({ key: `documents`, class: Markdown })
		expect(() =>
			timelineFamily({
				key: `unsafeDocumentHistories`,
				scope: [scopeFamily(documentsAtoms, { timelineKey: (key) => key })],
			}),
		).toThrow(`append-only`)
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

	test(`emits complete signals and clones through toJSON/fromJSON`, () => {
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
		expect(document.text).toBe(`A👨‍👩‍👧‍👦é`)
		const clone = Markdown.fromJSON(document.toJSON())
		expect(clone.text).toBe(document.text)
		expect(clone).not.toBe(document)
		expect(() => {
			clone.undo(signal)
		}).toThrow(`append-only`)
	})

	test(`uses deterministic Unicode grapheme primitives`, () => {
		expect(splitMosaicText(`👨‍👩‍👧‍👦é`)).toEqual([`👨‍👩‍👧‍👦`, `é`])
		expect(compareMosaicIds(`a`, `b`)).toBe(-1)
		expect(compareMosaicIds(`b`, `a`)).toBe(1)
		expect(compareMosaicIds(`same`, `same`)).toBe(0)
		expect(createEmptyMosaicText()).toEqual({
			actions: [],
			activeEdits: {},
			nodes: {},
		})
		expect(() => mosaicText({ maximumGraphemes: 0 })).toThrow(
			`maximumGraphemes must be a positive safe integer`,
		)
		expect(() => mosaicText({ maximumGraphemes: 1.5 })).toThrow(
			`maximumGraphemes must be a positive safe integer`,
		)
		expect(() => mosaicText({ initialText: `ab`, maximumGraphemes: 1 })).toThrow(
			`initialText exceeds maximumGraphemes`,
		)
	})

	test(`concurrent inserted runs converge without interleaving`, () => {
		const Markdown = mosaicText({ initialText: `A` })
		const base = new Markdown().toJSON()
		const alice = Markdown.fromJSON(base)
		const bob = Markdown.fromJSON(base)
		const aliceSignal = change(
			alice,
			{ text: `A[ALICE]`, type: `replace-text` },
			context(`alice:operation:1`, `alice`, `alice:group`),
		)
		const bobSignal = change(
			bob,
			{ text: `A[BOB]`, type: `replace-text` },
			context(`bob:operation:1`, `bob`, `bob:group`),
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
	})

	test(`selective history preserves foreign work`, () => {
		const Markdown = mosaicText({ initialText: `Seed` })
		const document = new Markdown()
		const jane = change(
			document,
			{ text: `Seed[Jane]`, type: `replace-text` },
			context(`jane:1`, `jane`, `jane:typing`),
		)
		const dave = change(
			document,
			{ text: `Seed[Jane][Dave]`, type: `replace-text` },
			context(`dave:1`, `dave`, `dave:typing`, [jane.id]),
		)
		expect(document.historyFor(`jane`).undo.at(-1)).toEqual({
			group: `jane:typing`,
			targetOperationIds: [jane.id],
		})
		const undo = change(
			document,
			{ type: `undo` },
			context(`jane:2`, `jane`, `jane:2`, [dave.id]),
		)
		expect(document.text).toBe(`Seed[Dave]`)
		expect(document.historyFor(`jane`).redo).toHaveLength(1)
		change(
			document,
			{ type: `redo` },
			context(`jane:3`, `jane`, `jane:3`, [undo.id]),
		)
		expect(document.text).toBe(`Seed[Jane][Dave]`)
	})

	test(`groups edits and closes stale history`, () => {
		const Markdown = mosaicText({ initialText: `A` })
		const document = new Markdown()
		change(
			document,
			{ text: `AB`, type: `replace-text` },
			context(`alice:1`, `alice`, `typing`),
		)
		change(
			document,
			{ text: `ABC`, type: `replace-text` },
			context(`alice:2`, `alice`, `typing`),
		)
		expect(document.historyFor(`alice`).undo.at(-1)).toEqual({
			group: `typing`,
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
			reason: `The actor history cursor is stale.`,
			status: `reject`,
		})
	})

	test(`validates malformed, over-capacity, and non-causal operations`, () => {
		const Markdown = mosaicText({ initialText: `ab`, maximumGraphemes: 2 })
		const document = new Markdown()
		const metadata: MosaicReduceContext = {
			...context(`alice:1`, `alice`),
			revision: null,
		}
		const [first, second] = document.nodes
		const nodeId = `${metadata.id}:node:000000`
		const edit = (overrides: Record<string, unknown> = {}) => ({
			deletedIds: [],
			inserted: [{ after: first.id, before: second.id, id: nodeId, value: `X` }],
			type: `edit`,
			...overrides,
		})
		expect(document.validate(null, metadata)).toEqual({
			reason: `Operation must be an object.`,
			status: `reject`,
		})
		expect(document.validate(edit(), metadata)).toEqual({
			reason: `The text exceeds its grapheme capacity.`,
			status: `reject`,
		})
		expect(
			document.validate(
				edit({
					inserted: [{ after: `missing`, before: null, id: nodeId, value: `X` }],
				}),
				{ ...metadata, dependencies: [`future`] },
			),
		).toEqual({ dependencies: [`future`], status: `defer` })
		expect(document.validate({ type: `mystery` }, metadata)).toEqual({
			reason: `Unknown text operation type.`,
			status: `reject`,
		})
	})

	test(`rejects collisions and hydrates only validated action history`, () => {
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
				operation: { deletedIds: [], inserted: [], type: `edit` },
			}),
		).toThrow(`Mosaic operation id collision`)
		const snapshot = document.toJSON()
		const poisoned = {
			...snapshot,
			activeEdits: {},
			nodes: {},
		} satisfies MosaicTextSnapshot
		expect(Markdown.fromJSON(poisoned).text).toBe(`AB`)
		expect(() => Markdown.fromJSON(null as never)).toThrow(
			`Invalid Mosaic text snapshot`,
		)
	})

	test(`relative positions survive hidden anchors and checkpoints`, () => {
		const Markdown = mosaicText({ initialText: `abc` })
		const document = new Markdown()
		const position = document.positionAtOffset(2)
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
				leftId: `unknown-left`,
				rightId: `unknown-right`,
			}),
		).toBe(0)
	})

	test(`applies accepted revisions idempotently`, () => {
		const Markdown = mosaicText()
		const author = new Markdown()
		const provisional = change(
			author,
			{ text: `hello`, type: `replace-text` },
			context(`alice:1`, `alice`),
		)
		const replica = new Markdown()
		const operation = accepted(provisional, 1)
		replica.do(operation)
		replica.do(operation)
		expect(replica.text).toBe(`hello`)
	})
})
