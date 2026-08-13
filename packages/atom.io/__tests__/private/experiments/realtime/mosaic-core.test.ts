import {
	compareMosaicIds,
	createEmptyMosaicText,
	defineMosaicModel,
	defineMosaicResource,
	materializeMosaicText,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicReduceContext,
	mosaicText,
	type MosaicTextIntent,
	type MosaicTextOperation,
	type MosaicTextSnapshot,
	type MosaicTextState,
	resolveMosaicTextPosition,
	splitMosaicText,
} from "atom.io/realtime"

function context(
	id: string,
	actor: string,
	group = id,
	dependencies: readonly string[] = [],
): MosaicReduceContext {
	return {
		actor,
		dependencies,
		group,
		id,
		revision: null,
		session: `${actor}:tab`,
	}
}

function prepare(
	model: ReturnType<typeof mosaicText>,
	state: MosaicTextState,
	intent: MosaicTextIntent,
	metadata: MosaicReduceContext,
): MosaicTextOperation {
	const operation = model.prepare(state, intent, {
		...metadata,
		now: 10,
		revision: null,
	})
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
		expect(() => defineMosaicModel({ ...model, key: `` })).toThrow(
			`A Mosaic model key cannot be empty`,
		)
	})

	test(`validates text model bounds and deterministic Unicode primitives`, () => {
		expect(splitMosaicText(`👨‍👩‍👧‍👦é`)).toEqual([`👨‍👩‍👧‍👦`, `é`])
		expect(compareMosaicIds(`a`, `b`)).toBe(-1)
		expect(compareMosaicIds(`b`, `a`)).toBe(1)
		expect(compareMosaicIds(`same`, `same`)).toBe(0)
		expect(createEmptyMosaicText()).toEqual({
			actions: [],
			activeEdits: {},
			nodes: {},
		})
		expect(mosaicText().text(mosaicText().create())).toBe(``)
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

	test(`bounds a middle replacement before its retained suffix`, () => {
		const model = mosaicText({ initialText: `abc` })
		const state = model.create()
		const metadata = context(`zoe:operation:1`, `zoe`)
		const operation = prepare(
			model,
			state,
			{ text: `aXc`, type: `replace-text` },
			metadata,
		)
		expect(model.text(model.apply(state, operation, metadata))).toBe(`aXc`)
	})

	test(`canonicalizes accepted history by server revision`, () => {
		const model = mosaicText({ initialText: `A` })
		const base = model.create()
		const localEdit = context(`alice:1`, `alice`)
		const edit = prepare(
			model,
			base,
			{ text: `AB`, type: `replace-text` },
			localEdit,
		)
		const editContext = { ...localEdit, revision: 1 }
		const afterEdit = model.apply(base, edit, editContext)
		const localUndo = context(`alice:2`, `alice`)
		const undo = prepare(model, afterEdit, { type: `undo` }, localUndo)
		const undoContext = { ...localUndo, revision: 2 }
		const ordered = model.apply(afterEdit, undo, undoContext)
		const reversed = model.apply(
			model.apply(base, undo, undoContext),
			edit,
			editContext,
		)
		expect(model.text(reversed)).toBe(model.text(ordered))
		expect(model.text(reversed)).toBe(`A`)
	})

	test(`orders accepted operations before provisional operations`, () => {
		const model = mosaicText()
		const base = model.create()
		const provisionalContext = context(`provisional`, `alice`)
		const provisional = prepare(
			model,
			base,
			{ text: `P`, type: `replace-text` },
			provisionalContext,
		)
		const withProvisional = model.apply(base, provisional, provisionalContext)
		const acceptedContext = {
			...context(`accepted`, `bob`),
			revision: 1,
		}
		const accepted = prepare(
			model,
			base,
			{ text: `A`, type: `replace-text` },
			acceptedContext,
		)
		const combined = model.apply(withProvisional, accepted, acceptedContext)
		expect(combined.actions.map(({ id }) => id)).toEqual([
			`accepted`,
			`provisional`,
		])
	})

	test(`fails closed on operation id collisions and malformed snapshots`, () => {
		const model = mosaicText({ initialText: `A` })
		const base = model.create()
		const metadata = context(`alice:1`, `alice`)
		const operation = prepare(
			model,
			base,
			{ text: `AB`, type: `replace-text` },
			metadata,
		)
		const accepted = model.apply(base, operation, metadata)
		expect(() =>
			model.apply(
				accepted,
				{ deletedIds: [], inserted: [], type: `edit` },
				metadata,
			),
		).toThrow(`Mosaic operation id collision`)
		expect(() => model.hydrate({ actions: [{}] })).toThrow(
			`Invalid Mosaic text snapshot`,
		)
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

	test(`groups adjacent edits and clears redo when a new edit is applied`, () => {
		const model = mosaicText({ initialText: `A` })
		const base = model.create()
		const firstContext = context(`alice:1`, `alice`, `typing`)
		const first = prepare(
			model,
			base,
			{ text: `AB`, type: `replace-text` },
			firstContext,
		)
		const afterFirst = model.apply(base, first, firstContext)
		const secondContext = context(`alice:2`, `alice`, `typing`)
		const second = prepare(
			model,
			afterFirst,
			{ text: `ABC`, type: `replace-text` },
			secondContext,
		)
		const afterSecond = model.apply(afterFirst, second, secondContext)
		expect(model.timeline(afterSecond, `alice`).undo.at(-1)).toEqual({
			group: `typing`,
			targetOperationIds: [`alice:1`, `alice:2`],
		})

		const undoContext = context(`alice:3`, `alice`)
		const undo = prepare(model, afterSecond, { type: `undo` }, undoContext)
		const undone = model.apply(afterSecond, undo, undoContext)
		expect(model.timeline(undone, `alice`).redo).toHaveLength(1)
		const newContext = context(`alice:4`, `alice`, `replacement`)
		const replacement = prepare(
			model,
			undone,
			{ text: `AX`, type: `replace-text` },
			newContext,
		)
		const replaced = model.apply(undone, replacement, newContext)
		expect(model.timeline(replaced, `alice`).redo).toEqual([])
		expect(
			model.prepare(
				model.create(),
				{ type: `undo` },
				{
					...newContext,
					now: 10,
					revision: null,
				},
			),
		).toBeNull()
		expect(
			model.prepare(
				model.create(),
				{ type: `redo` },
				{
					...newContext,
					now: 10,
					revision: null,
				},
			),
		).toBeNull()
		expect(
			model.prepare(
				model.create(),
				{ text: `A`, type: `replace-text` },
				{
					...newContext,
					now: 10,
					revision: null,
				},
			),
		).toBeNull()
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

	test(`fails malformed and non-causal operations closed`, () => {
		const model = mosaicText({ initialText: `ab`, maximumGraphemes: 2 })
		const base = model.create()
		const metadata = context(`alice:1`, `alice`)
		const firstId = model.visibleNodes(base)[0].id
		const secondId = model.visibleNodes(base)[1].id
		const nodeId = `${metadata.id}:node:000000`
		const edit = (overrides: Record<string, unknown> = {}) => ({
			deletedIds: [],
			inserted: [{ after: firstId, before: secondId, id: nodeId, value: `X` }],
			type: `edit`,
			...overrides,
		})

		expect(model.validate(base, null, metadata)).toEqual({
			reason: `Operation must be an object.`,
			status: `reject`,
		})
		expect(model.validate(base, { type: `edit` }, metadata)).toEqual({
			reason: `Malformed text edit.`,
			status: `reject`,
		})
		expect(model.validate(base, edit({ inserted: [null] }), metadata)).toEqual({
			reason: `Malformed inserted grapheme.`,
			status: `reject`,
		})
		expect(
			model.validate(
				base,
				edit({
					inserted: [
						{ after: firstId, before: secondId, id: nodeId, value: `XY` },
					],
				}),
				metadata,
			),
		).toEqual({ reason: `Invalid inserted grapheme chain.`, status: `reject` })
		expect(
			model.validate(
				base,
				edit({
					inserted: [{ after: `missing`, before: null, id: nodeId, value: `X` }],
				}),
				metadata,
			),
		).toEqual({ reason: `Unknown predecessor anchor.`, status: `reject` })
		expect(
			model.validate(
				base,
				edit({
					inserted: [{ after: null, before: `missing`, id: nodeId, value: `X` }],
				}),
				context(metadata.id, `alice`, metadata.group ?? metadata.id, [`future`]),
			),
		).toEqual({ dependencies: [`future`], status: `defer` })
		expect(
			model.validate(
				base,
				edit({
					inserted: [{ after: null, before: `missing`, id: nodeId, value: `X` }],
				}),
				metadata,
			),
		).toEqual({ reason: `Unknown successor anchor.`, status: `reject` })
		expect(
			model.validate(
				base,
				edit({
					inserted: [
						{ after: secondId, before: firstId, id: nodeId, value: `X` },
					],
				}),
				metadata,
			),
		).toEqual({
			reason: `The insertion interval is inverted.`,
			status: `reject`,
		})
		expect(
			model.validate(
				base,
				edit({ deletedIds: [firstId, firstId], inserted: [] }),
				metadata,
			),
		).toEqual({ reason: `Malformed deletion targets.`, status: `reject` })
		expect(
			model.validate(
				base,
				edit({ deletedIds: [`missing`], inserted: [] }),
				metadata,
			),
		).toEqual({ reason: `Unknown deletion target.`, status: `reject` })
		expect(
			model.validate(
				base,
				edit({ deletedIds: [`missing`], inserted: [] }),
				context(metadata.id, `alice`, metadata.group ?? metadata.id, [`future`]),
			),
		).toEqual({ dependencies: [`future`], status: `defer` })
		expect(model.validate(base, edit(), metadata)).toEqual({
			reason: `The text exceeds its grapheme capacity.`,
			status: `reject`,
		})
		expect(
			model.validate(
				base,
				{ mode: `undo`, targetOperationIds: [], type: `history` },
				metadata,
			),
		).toEqual({ reason: `Malformed history operation.`, status: `reject` })
		expect(model.validate(base, { type: `mystery` }, metadata)).toEqual({
			reason: `Unknown text operation type.`,
			status: `reject`,
		})
	})

	test(`rejects malformed snapshots and reconstructs state from accepted actions`, () => {
		const model = mosaicText({ initialText: `A` })
		const base = model.create()
		const metadata = context(`alice:1`, `alice`)
		const operation = prepare(
			model,
			base,
			{ text: `AB`, type: `replace-text` },
			metadata,
		)
		const state = model.apply(base, operation, metadata)
		const snapshot = model.snapshot(state)
		const poisoned = {
			...snapshot,
			activeEdits: {},
			nodes: {},
		} satisfies MosaicTextSnapshot
		expect(model.text(model.hydrate(poisoned))).toBe(`AB`)

		expect(() => model.hydrate(null)).toThrow(`Invalid Mosaic text snapshot`)
		expect(() => model.hydrate({ actions: [null] })).toThrow(
			`Invalid Mosaic text snapshot`,
		)
		expect(() =>
			model.hydrate({ actions: [{ ...snapshot.actions[0], actor: `` }] }),
		).toThrow(`Invalid Mosaic text snapshot`)
		expect(() =>
			model.hydrate({
				actions: [
					{
						actor: `alice`,
						dependencies: [],
						group: `alice:1`,
						id: `alice:1`,
						operation: { type: `mystery` },
						revision: 1,
						session: `alice:tab`,
					},
				],
			}),
		).toThrow(`Unknown text operation type`)
		expect(() =>
			model.hydrate({
				actions: [
					{
						actor: `alice`,
						dependencies: [`future`],
						group: `alice:1`,
						id: `alice:1`,
						operation: {
							deletedIds: [],
							inserted: [
								{
									after: `future:node`,
									before: null,
									id: `alice:1:node:000000`,
									value: `X`,
								},
							],
							type: `edit`,
						},
						revision: 1,
						session: `alice:tab`,
					},
				],
			}),
		).toThrow(`missing dependencies future`)
	})

	test(`relative positions survive hidden anchors and snapshots`, () => {
		const model = mosaicText({ initialText: `abc` })
		const base = model.create()
		const position = model.positionAtOffset(base, 2)
		expect(model.resolvePosition(base, position)).toBe(2)
		const deletionContext = context(`alice:delete:1`, `alice`)
		const deletion = prepare(
			model,
			base,
			{ text: `ac`, type: `replace-text` },
			deletionContext,
		)
		const withHiddenAnchor = model.apply(base, deletion, deletionContext)
		expect(model.resolvePosition(withHiddenAnchor, position)).toBe(1)
		const selection = model.selectionFromOffsets(base, 1, 3)
		expect(model.resolvePosition(base, selection.anchor)).toBe(1)
		expect(model.resolvePosition(base, selection.head)).toBe(3)
		const hydrated = model.hydrate(model.snapshot(base))
		expect(materializeMosaicText(hydrated)).toBe(`abc`)
		expect(hydrated).not.toBe(base)
	})

	test(`resolves Unicode interiors and relative-position affinity fallbacks`, () => {
		const emojiModel = mosaicText({ initialText: `😀a` })
		const emoji = emojiModel.create()
		const interior = emojiModel.positionAtOffset(emoji, 1)
		expect(interior.affinity).toBe(`left`)
		expect(emojiModel.resolvePosition(emoji, interior)).toBe(2)

		const model = mosaicText({ initialText: `abcd` })
		const base = model.create()
		const betweenHidden = model.positionAtOffset(base, 2)
		const deletionContext = context(`alice:delete`, `alice`)
		const deletion = prepare(
			model,
			base,
			{ text: `ad`, type: `replace-text` },
			deletionContext,
		)
		const deleted = model.apply(base, deletion, deletionContext)
		expect(model.resolvePosition(deleted, betweenHidden)).toBe(1)
		expect(
			resolveMosaicTextPosition(deleted, {
				affinity: `left`,
				leftId: null,
				rightId: model.visibleNodes(deleted)[1].id,
			}),
		).toBe(1)
		expect(
			resolveMosaicTextPosition(deleted, {
				affinity: `left`,
				leftId: `unknown-left`,
				rightId: `unknown-right`,
			}),
		).toBe(0)
	})
})
