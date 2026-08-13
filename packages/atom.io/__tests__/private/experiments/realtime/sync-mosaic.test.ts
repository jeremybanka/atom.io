import { Silo } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import { clearStore } from "atom.io/internal"
import {
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicAcceptedOperationEnvelope,
	type MosaicOperationProposal,
	type MosaicSnapshotEnvelope,
	mosaicText,
	type MosaicTextOperation,
} from "atom.io/realtime"
import {
	type MosaicClientTransport,
	type MosaicController,
	syncMosaic,
} from "atom.io/realtime-client"
import { vitest } from "vitest"

const storeConfig = (name: string) => ({
	isProduction: false,
	lifespan: `ephemeral` as const,
	name,
})

class ControlledTransport implements MosaicClientTransport {
	public connected: boolean
	public readonly outgoing: Array<{
		args: readonly Json.Serializable[]
		event: string
	}> = []
	readonly #listeners = new Map<
		string,
		Set<(...args: Json.Serializable[]) => void>
	>()

	public constructor(connected = false) {
		this.connected = connected
	}

	public emit(event: string, ...args: Json.Serializable[]): void {
		this.outgoing.push({ args: structuredClone(args), event })
	}

	public off(
		event: string,
		listener?: (...args: Json.Serializable[]) => void,
	): void {
		if (listener === undefined) this.#listeners.delete(event)
		else this.#listeners.get(event)?.delete(listener)
	}

	public on(
		event: string,
		listener: (...args: Json.Serializable[]) => void,
	): void {
		const listeners = this.#listeners.get(event) ?? new Set()
		listeners.add(listener)
		this.#listeners.set(event, listeners)
	}

	public receive(event: string, ...args: Json.Serializable[]): void {
		if (event === `connect`) this.connected = true
		if (event === `disconnect`) this.connected = false
		for (const listener of [...(this.#listeners.get(event) ?? [])]) {
			listener(...structuredClone(args))
		}
	}

	public sent<T extends Json.Serializable>(event: string): T[] {
		return this.outgoing
			.filter((entry) => entry.event === event)
			.map((entry) => entry.args[0] as T)
	}
}

const Text = mosaicText()
type TextTransceiver = InstanceType<typeof Text>

function setup(name: string, connected = false) {
	const $ = new Silo(storeConfig(name))
	const notesAtom = $.mutableAtom<TextTransceiver>({
		key: `notes`,
		class: Text,
	})
	const socket = new ControlledTransport(connected)
	const controller = syncMosaic<TextTransceiver, { cursor: number }>(
		$.store,
		notesAtom,
		{
			actor: `alice`,
			clock: () => 1_000,
			idSource: ({ kind, sequence }) => `${kind}-${sequence}`,
			session: `alice-tab`,
			transport: socket,
		},
	)
	return { $, controller, notesAtom, socket }
}

function snapshot(
	controller: MosaicController<TextTransceiver, { cursor: number }>,
	overrides: Partial<
		MosaicSnapshotEnvelope<ReturnType<TextTransceiver[`toJSON`]>>
	> = {},
): MosaicSnapshotEnvelope<ReturnType<TextTransceiver[`toJSON`]>> {
	return {
		acceptedPendingOperationIds: [],
		atom: controller.atom,
		model: Text.mosaic,
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		revision: 0,
		session: controller.session,
		snapshot: new Text().toJSON(),
		...overrides,
	}
}

function proposal(
	controller: MosaicController<TextTransceiver, { cursor: number }>,
	text: string,
	id: string,
	actor = `bob`,
): MosaicAcceptedOperationEnvelope<MosaicTextOperation> {
	const source = new Text()
	const signal = source.change(
		{ text, type: `replace-text` },
		{
			actor,
			dependencies: [],
			group: null,
			id,
			now: 1_000,
			revision: null,
			session: `${actor}-tab`,
		},
	)
	if (signal === null) throw new Error(`Expected a text operation`)
	return {
		operation: {
			actor,
			atom: controller.atom,
			dependencies: signal.dependencies,
			group: signal.group,
			id: signal.id,
			model: Text.mosaic,
			operation: signal.operation,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: signal.session,
		},
		revision: 1,
	}
}

function hydrate(
	controller: MosaicController<TextTransceiver, { cursor: number }>,
	socket: ControlledTransport,
): void {
	socket.receive(MOSAIC_EVENTS.snapshot, snapshot(controller))
}

describe(`syncMosaic`, () => {
	it(`owns one controller per Store, atom, and session`, () => {
		const { $, controller, notesAtom, socket } = setup(`singleton`)
		const second = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			clock: () => 1_000,
			idSource: vitest.fn(),
			session: `alice-tab`,
			transport: socket,
		})

		// Ownership identity is Store + atom + session; reconnect helpers may vary.
		expect(second).toBe(controller)
	})

	it(`shares equivalent bindings and rejects configuration conflicts`, () => {
		const $ = new Silo(storeConfig(`singleton`))
		const notesAtom = $.mutableAtom<TextTransceiver>({
			key: `notes`,
			class: Text,
		})
		const socket = new ControlledTransport()
		const first = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			session: `alice-tab`,
			transport: socket,
		})
		const second = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			session: `alice-tab`,
			transport: socket,
		})

		expect(second).toBe(first)
		expect(() =>
			syncMosaic($.store, notesAtom, {
				actor: `bob`,
				session: `alice-tab`,
				transport: socket,
			}),
		).toThrow(`already has a different configuration`)
	})

	it(`exposes synchronization metadata as ordinary Store state`, () => {
		const { $, controller } = setup(`companions`)

		expect($.getState(controller.state.status)).toBe(`offline`)
		expect($.getState(controller.state.revision)).toBe(0)
		expect($.getState(controller.state.pending)).toEqual([])
		expect($.getState(controller.state.presence)).toEqual([])
		expect($.getState(controller.state.problem)).toBeNull()
	})

	it(`updates ordinary selectors for local operations`, () => {
		const { $, controller, notesAtom } = setup(`local-selector`)
		const textSelector = $.selector<string>({
			key: `text`,
			get: ({ get }) => get(notesAtom).text,
		})
		const updates = vitest.fn()
		$.subscribe(textSelector, updates)
		expect($.getState(textSelector)).toBe(``)

		controller.change({ text: `local`, type: `replace-text` })

		expect($.getState(textSelector)).toBe(`local`)
		expect(updates).toHaveBeenCalledWith({ oldValue: ``, newValue: `local` })
		expect($.getState(controller.state.pending)).toEqual([`operation-0`])
	})

	it(`applies foreign accepted operations through the mutable atom graph`, () => {
		const { $, controller, notesAtom, socket } = setup(`foreign-selector`, true)
		const textSelector = $.selector<string>({
			key: `text`,
			get: ({ get }) => get(notesAtom).text,
		})
		const updates = vitest.fn()
		$.subscribe(textSelector, updates)
		expect($.getState(textSelector)).toBe(``)
		hydrate(controller, socket)

		socket.receive(MOSAIC_EVENTS.operation, proposal(controller, `remote`, `b`))

		expect($.getState(textSelector)).toBe(`remote`)
		expect($.getState(controller.state.revision)).toBe(1)
		expect(updates).toHaveBeenCalled()
	})

	it(`rebases pending local work without losing selector updates`, () => {
		const { $, controller, notesAtom, socket } = setup(`rebase`, true)
		const textSelector = $.selector<string>({
			key: `text`,
			get: ({ get }) => get(notesAtom).text,
		})
		const updates = vitest.fn()
		$.subscribe(textSelector, updates)
		expect($.getState(textSelector)).toBe(``)
		hydrate(controller, socket)
		controller.change({ text: `ours`, type: `replace-text` })

		socket.receive(MOSAIC_EVENTS.operation, proposal(controller, `theirs`, `a`))

		expect($.getState(textSelector)).toContain(`ours`)
		expect($.getState(textSelector)).toContain(`theirs`)
		expect($.getState(controller.state.pending)).toEqual([`operation-0`])
		expect(updates.mock.calls.length).toBeGreaterThanOrEqual(2)
	})

	it(`buffers committed transaction signals and drops aborted signals`, () => {
		const { $, controller, socket } = setup(`transactions`, true)
		hydrate(controller, socket)
		const abortTransaction = $.transaction<() => void>({
			key: `abort`,
			do: () => {
				controller.change({ text: `aborted`, type: `replace-text` })
				throw new Error(`abort`)
			},
		})

		expect(() => {
			$.runTransaction(abortTransaction)()
		}).toThrow(`abort`)
		expect($.getState(controller.state.pending)).toEqual([])
		expect(socket.sent(MOSAIC_EVENTS.operation)).toEqual([])

		const commitTransaction = $.transaction<() => void>({
			key: `commit`,
			do: () => {
				controller.change({ text: `first`, type: `replace-text` })
				controller.change({ text: `committed`, type: `replace-text` })
			},
		})
		$.runTransaction(commitTransaction)()

		expect($.getState(controller.state.pending)).toEqual([
			`operation-1`,
			`operation-2`,
		])
		const committed = socket.sent<MosaicOperationProposal<MosaicTextOperation>>(
			MOSAIC_EVENTS.operation,
		)
		expect(committed).toHaveLength(2)
		expect(committed[1]?.dependencies).toEqual([`operation-1`])
	})

	it(`exposes stamped presence envelopes through companion state`, () => {
		const { $, controller, socket } = setup(`presence`, true)
		hydrate(controller, socket)

		socket.receive(MOSAIC_EVENTS.presence, {
			actor: `bob`,
			atom: controller.atom,
			presence: { cursor: 4 },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: `bob-tab`,
		})

		expect($.getState(controller.state.presence)).toEqual([
			{
				actor: `bob`,
				atom: controller.atom,
				presence: { cursor: 4 },
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				session: `bob-tab`,
			},
		])
	})

	it(`supports reconnect, retry, resynchronize, and presence departure`, () => {
		const { $, controller, socket } = setup(`lifecycle`, true)
		hydrate(controller, socket)
		controller.publishPresence({ cursor: 2 })
		controller.change({ text: `pending`, type: `replace-text` })
		expect(socket.sent(MOSAIC_EVENTS.operation)).toHaveLength(1)

		controller.retryPending()
		expect(socket.sent(MOSAIC_EVENTS.operation)).toHaveLength(2)
		controller.synchronize()
		expect($.getState(controller.state.status)).toBe(`syncing`)
		hydrate(controller, socket)
		expect(socket.sent(MOSAIC_EVENTS.operation)).toHaveLength(3)

		socket.receive(`disconnect`)
		expect($.getState(controller.state.status)).toBe(`offline`)
		expect($.getState(controller.state.presence)).toEqual([])
		socket.receive(`connect`)
		expect($.getState(controller.state.status)).toBe(`syncing`)
		expect(socket.sent(MOSAIC_EVENTS.join).length).toBeGreaterThanOrEqual(3)
	})

	it(`quarantines a rejected causal chain and exposes recovery`, () => {
		const { $, controller, socket } = setup(`rejection`, true)
		hydrate(controller, socket)
		controller.change({ text: `first`, type: `replace-text` })
		controller.change({ text: `second`, type: `replace-text` })

		socket.receive(MOSAIC_EVENTS.rejection, {
			atom: controller.atom,
			code: `invalid-model-operation`,
			operationId: `operation-0`,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `invalid`,
			recovery: `discard-operation`,
			session: controller.session,
		})

		expect($.getState(controller.state.pending)).toEqual([])
		expect($.getState(controller.state.problem)).toMatchObject({
			discarded: [{ id: `operation-0` }, { id: `operation-1` }],
			kind: `rejection`,
			recovery: `discard-operation`,
		})
		expect($.getState(controller.state.status)).toBe(`live`)
		controller.clearProblem()
		expect($.getState(controller.state.problem)).toBeNull()
	})

	it(`fails closed for terminal rejections`, () => {
		const { $, controller, socket } = setup(`terminal-rejection`, true)
		hydrate(controller, socket)
		controller.change({ text: `pending`, type: `replace-text` })

		socket.receive(MOSAIC_EVENTS.rejection, {
			atom: controller.atom,
			code: `unauthorized`,
			operationId: null,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `no access`,
			recovery: `none`,
			session: controller.session,
		})

		expect($.getState(controller.state.status)).toBe(`rejected`)
		expect($.getState(controller.state.pending)).toEqual([])
		expect(
			controller.change({ text: `blocked`, type: `replace-text` }),
		).toBeNull()
	})

	it(`recovers revision gaps with a fresh join`, () => {
		const { $, controller, socket } = setup(`gap`, true)
		hydrate(controller, socket)
		const skipped = proposal(controller, `future`, `future`)

		socket.receive(MOSAIC_EVENTS.operation, { ...skipped, revision: 2 })

		expect($.getState(controller.state.status)).toBe(`recovering`)
		expect(socket.sent(MOSAIC_EVENTS.join).at(-1)).toMatchObject({
			knownRevision: 0,
		})
	})

	it(`fails closed on malformed snapshots and can clear diagnostics`, () => {
		const { $, controller, socket } = setup(`malformed`, true)

		socket.receive(MOSAIC_EVENTS.snapshot, {
			...snapshot(controller),
			revision: -1,
		})

		expect($.getState(controller.state.status)).toBe(`rejected`)
		expect($.getState(controller.state.problem)).toMatchObject({
			kind: `protocol`,
		})
		controller.clearProblem()
		expect($.getState(controller.state.problem)).toBeNull()
	})

	it(`keeps projections and controllers independent between Silos`, () => {
		const Uno = new Silo(storeConfig(`uno`))
		const Dos = new Silo(storeConfig(`dos`))
		const unoNotesAtom = Uno.mutableAtom<TextTransceiver>({
			// eslint-disable-next-line atom.io/naming-convention
			key: `notes`,
			class: Text,
		})
		const dosNotesAtom = Dos.mutableAtom<TextTransceiver>({
			// eslint-disable-next-line atom.io/naming-convention
			key: `notes`,
			class: Text,
		})
		const uno = syncMosaic(Uno.store, unoNotesAtom, {
			actor: `alice`,
			session: `same-session`,
		})
		const dos = syncMosaic(Dos.store, dosNotesAtom, {
			actor: `alice`,
			session: `same-session`,
		})

		expect(uno).not.toBe(dos)
		uno.change({ text: `only uno`, type: `replace-text` })
		expect(Uno.getState(unoNotesAtom).text).toBe(`only uno`)
		expect(Dos.getState(dosNotesAtom).text).toBe(``)
	})

	it(`uses canonical family-member identity and follows member disposal`, () => {
		const $ = new Silo(storeConfig(`family`))
		const notesAtoms = $.mutableAtomFamily<TextTransceiver, string>({
			key: `notes`,
			class: Text,
		})
		const notesAtom = $.findState(notesAtoms, `one`)
		const controller = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			session: `alice-tab`,
		})

		expect(controller.atom).toEqual({
			family: { key: `notes`, subKey: `"one"` },
			key: `notes("one")`,
			type: `mutable_atom`,
		})

		$.disposeState(notesAtoms, `one`)
		expect($.store.miscResources.size).toBe(0)
	})

	it(`removes Store-owned resources and companion members on disposal`, () => {
		const { $, controller } = setup(`disposal`)
		const companionKeys = Object.values(controller.state).map(({ key }) => key)

		controller.dispose()
		controller.dispose()

		expect($.store.miscResources.size).toBe(0)
		for (const key of companionKeys) expect($.store.atoms.has(key)).toBe(false)
	})

	it(`participates in Store cleanup`, () => {
		const { $, controller } = setup(`cleanup`)

		clearStore($.store)
		controller.dispose()

		expect($.store.miscResources.size).toBe(0)
	})

	it(`removes accepted local operations from the Store-owned outbox`, () => {
		const { $, controller, socket } = setup(`accept`, true)
		hydrate(controller, socket)
		controller.change({ text: `accepted`, type: `replace-text` })
		const [local] = socket.sent<MosaicOperationProposal<MosaicTextOperation>>(
			MOSAIC_EVENTS.operation,
		)
		if (local === undefined) throw new Error(`Expected a local proposal`)

		socket.receive(MOSAIC_EVENTS.operation, {
			operation: { ...local, actor: `alice` },
			revision: 1,
		})

		expect($.getState(controller.state.pending)).toEqual([])
		expect($.getState(controller.state.revision)).toBe(1)
	})
})
