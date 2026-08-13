import {
	defineMosaicModel,
	defineMosaicResource,
	materializeMosaicText,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicReduceContext,
	mosaicText,
	type MosaicTextIntent,
	type MosaicTextOperation,
	type MosaicTextState,
} from "atom.io/realtime"

function context(
	id: string,
	actor: string,
	group = id,
	dependencies: readonly string[] = [],
): MosaicReduceContext {
	return { actor, dependencies, group, id, session: `${actor}:tab` }
}

function prepare(
	model: ReturnType<typeof mosaicText>,
	state: MosaicTextState,
	intent: MosaicTextIntent,
	metadata: MosaicReduceContext,
): MosaicTextOperation {
	const operation = model.prepare(state, intent, { ...metadata, now: 10 })
	if (operation === null) throw new Error(`Expected an operation`)
	return operation
}

describe(`Mosaic core`, () => {
	test(`declares versioned models and resources`, () => {
		const model = mosaicText()
		const resource = defineMosaicResource({ key: `notes`, model })
		expect(resource).toEqual({ key: `notes`, model })
		expect(MOSAIC_PROTOCOL_VERSION).toBe(1)
		expect(() => defineMosaicResource({ key: ``, model })).toThrow(
			`A Mosaic resource key cannot be empty`,
		)
		expect(() =>
			defineMosaicModel({ ...model, key: `invalid`, version: 0 }),
		).toThrow(`A Mosaic model version must be a positive safe integer`)
	})

	test(`uses Unicode graphemes as stable sequence nodes`, () => {
		const model = mosaicText({ initialText: `A` })
		const state = model.create()
		const metadata = context(`alice:1`, `alice`)
		const operation = prepare(
			model,
			state,
			{ text: `A👨‍👩‍👧‍👦é`, type: `replace-text` },
			metadata,
		)
		expect(operation.type).toBe(`edit`)
		if (operation.type !== `edit`) return
		expect(operation.inserted.map(({ value }) => value)).toEqual([`👨‍👩‍👧‍👦`, `é`])
		const next = model.apply(state, operation, metadata)
		expect(model.text(next)).toBe(`A👨‍👩‍👧‍👦é`)
		expect(model.apply(next, operation, metadata)).toBe(next)
	})

	test(`concurrent inserted runs converge without interleaving`, () => {
		const model = mosaicText({ initialText: `A` })
		const base = model.create()
		const alice = context(`alice:operation:1`, `alice`, `alice:group`)
		const bob = context(`bob:operation:1`, `bob`, `bob:group`)
		const aliceOperation = prepare(
			model,
			base,
			{ text: `A[ALICE]`, type: `replace-text` },
			alice,
		)
		const bobOperation = prepare(
			model,
			base,
			{ text: `A[BOB]`, type: `replace-text` },
			bob,
		)
		const aliceThenBob = model.apply(
			model.apply(base, aliceOperation, alice),
			bobOperation,
			bob,
		)
		const bobThenAlice = model.apply(
			model.apply(base, bobOperation, bob),
			aliceOperation,
			alice,
		)
		expect(model.text(aliceThenBob)).toBe(model.text(bobThenAlice))
		expect(model.text(aliceThenBob)).toContain(`[ALICE]`)
		expect(model.text(aliceThenBob)).toContain(`[BOB]`)
	})

	test(`selective undo preserves a foreign descendant and redo restores its group`, () => {
		const model = mosaicText({ initialText: `Seed` })
		const base = model.create()
		const jane = context(`jane:operation:1`, `jane`, `jane:typing`)
		const janeEdit = prepare(
			model,
			base,
			{ text: `Seed[Jane]`, type: `replace-text` },
			jane,
		)
		const afterJane = model.apply(base, janeEdit, jane)
		const dave = context(`dave:operation:1`, `dave`, `dave:typing`, [jane.id])
		const daveEdit = prepare(
			model,
			afterJane,
			{ text: `Seed[Jane][Dave]`, type: `replace-text` },
			dave,
		)
		const collaborative = model.apply(afterJane, daveEdit, dave)

		const undoContext = context(`jane:operation:2`, `jane`)
		const undo = prepare(model, collaborative, { type: `undo` }, undoContext)
		expect(model.validate(collaborative, undo, undoContext).status).toBe(
			`accept`,
		)
		const undone = model.apply(collaborative, undo, undoContext)
		expect(model.text(undone)).toBe(`Seed[Dave]`)

		const redoContext = context(`jane:operation:3`, `jane`)
		const redo = prepare(model, undone, { type: `redo` }, redoContext)
		expect(model.text(model.apply(undone, redo, redoContext))).toBe(
			`Seed[Jane][Dave]`,
		)
	})

	test(`fails stale history closed and defers missing causal anchors`, () => {
		const model = mosaicText({ initialText: `A` })
		const base = model.create()
		const alice = context(`alice:1`, `alice`, `alice:group`)
		const aliceEdit = prepare(
			model,
			base,
			{ text: `AB`, type: `replace-text` },
			alice,
		)
		const afterAlice = model.apply(base, aliceEdit, alice)
		const bob = context(`bob:1`, `bob`, `bob:group`, [alice.id])
		const bobEdit = prepare(
			model,
			afterAlice,
			{ text: `ABC`, type: `replace-text` },
			bob,
		)
		expect(model.validate(base, bobEdit, bob)).toEqual({
			dependencies: [alice.id],
			status: `defer`,
		})

		const invalidHistory: MosaicTextOperation = {
			mode: `undo`,
			targetOperationIds: [`not-the-top`],
			type: `history`,
		}
		expect(
			model.validate(afterAlice, invalidHistory, context(`alice:2`, `alice`)),
		).toEqual({ reason: `The actor history cursor is stale.`, status: `reject` })
	})

	test(`relative positions survive hidden anchors and snapshots`, () => {
		const model = mosaicText({ initialText: `abc` })
		const base = model.create()
		const position = model.positionAtOffset(base, 2)
		expect(model.resolvePosition(base, position)).toBe(2)
		const selection = model.selectionFromOffsets(base, 1, 3)
		expect(model.resolvePosition(base, selection.anchor)).toBe(1)
		expect(model.resolvePosition(base, selection.head)).toBe(3)
		const hydrated = model.hydrate(model.snapshot(base))
		expect(materializeMosaicText(hydrated)).toBe(`abc`)
		expect(hydrated).not.toBe(base)
	})
})
