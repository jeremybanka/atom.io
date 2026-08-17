import { Silo } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import { clearStore, getUpdateToken, setIntoStore } from "atom.io/internal"
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
	type MosaicClientIdContext,
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
		atom: controller.address,
		headOperationIds: [],
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
			atom: controller.address,
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
		const $ = new Silo(storeConfig(`singleton`))
		const notesAtom = $.mutableAtom<TextTransceiver>({
			key: `notes`,
			class: Text,
		})
		const socket = new ControlledTransport()
		const clock = () => 1_000
		const idSource = ({ kind, sequence }: MosaicClientIdContext) =>
			`${kind}-${sequence}`
		const controller = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			clock,
			idSource,
			session: `alice-tab`,
			transport: socket,
		})
		const second = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			clock,
			idSource,
			session: `alice-tab`,
			transport: socket,
		})

		expect(second).toBe(controller)
		expect(controller.atom).toBe(notesAtom)
		expect(controller.address).toEqual({ key: `notes`, type: `mutable_atom` })
	})

	it(`shares equivalent bindings and rejects configuration conflicts`, () => {
		const $ = new Silo(storeConfig(`singleton`))
		const notesAtom = $.mutableAtom<TextTransceiver>({
			key: `notes`,
			class: Text,
		})
		const socket = new ControlledTransport()
		const clock = () => 1_000
		const idSource = ({ kind, sequence }: MosaicClientIdContext) =>
			`${kind}-${sequence}`
		const first = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			clock,
			idSource,
			session: `alice-tab`,
			transport: socket,
		})
		const second = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			clock,
			idSource,
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
		expect(() =>
			syncMosaic($.store, notesAtom, {
				actor: `alice`,
				clock: () => 1_000,
				idSource,
				session: `alice-tab`,
				transport: socket,
			}),
		).toThrow(`already has a different configuration`)
		expect(() =>
			syncMosaic($.store, notesAtom, {
				actor: `alice`,
				clock,
				idSource: () => `different`,
				session: `alice-tab`,
				transport: socket,
			}),
		).toThrow(`already has a different configuration`)
	})

	it(`validates actors, sessions, transceivers, and issued IDs`, () => {
		const $ = new Silo(storeConfig(`arguments`))
		const notesAtom = $.mutableAtom<TextTransceiver>({
			key: `notes`,
			class: Text,
		})

		expect(() =>
			syncMosaic($.store, notesAtom, { actor: ``, session: `tab` }),
		).toThrow(`actor cannot be empty`)
		expect(() =>
			syncMosaic($.store, notesAtom, { actor: `alice`, session: `` }),
		).toThrow(`session cannot be empty`)

		const NotMosaicText = class extends Text {}
		Object.defineProperty(NotMosaicText, `timelinePolicy`, { value: `rewind` })
		const counterAtom = $.mutableAtom<TextTransceiver>({
			key: `counter`,
			class: NotMosaicText,
		})
		expect(() =>
			syncMosaic($.store, counterAtom as never, {
				actor: `alice`,
				session: `tab`,
			}),
		).toThrow(`does not contain a Mosaic transceiver`)

		const InvalidMosaicText = class extends Text {}
		Object.defineProperty(InvalidMosaicText, `mosaic`, {
			value: { configuration: Number.NaN, key: `text`, version: 1 },
		})
		const invalidMosaicAtom = $.mutableAtom<TextTransceiver>({
			key: `invalidMosaic`,
			class: InvalidMosaicText,
		})
		expect(() =>
			syncMosaic($.store, invalidMosaicAtom as never, {
				actor: `alice`,
				session: `invalid-mosaic-tab`,
			}),
		).toThrow(`does not contain a Mosaic transceiver`)

		const emptyId = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			idSource: () => ``,
			session: `empty-id-tab`,
		})
		expect(() => emptyId.createGroupId()).toThrow(`ID cannot be empty`)

		const duplicateId = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			idSource: () => `duplicate`,
			session: `duplicate`,
		})
		expect(() => duplicateId.createGroupId()).toThrow(`was already issued`)
	})

	it(`generates a default session and monotonic group and operation IDs`, () => {
		const $ = new Silo(storeConfig(`default-identities`))
		const notesAtom = $.mutableAtom<TextTransceiver>({
			key: `notes`,
			class: Text,
		})
		const clock = vitest.fn(() => -1)
		const controller = syncMosaic($.store, notesAtom, { actor: `alice`, clock })

		expect(controller.session).toContain(`alice:session:`)
		expect(controller.createGroupId()).toContain(`:group:0000000000:`)
		expect(
			controller.change({ text: `generated`, type: `replace-text` })?.id,
		).toContain(`:operation:0000000000:`)
	})

	it(`exposes synchronization metadata as ordinary Store state`, () => {
		const { $, controller } = setup(`companions`)

		expect($.getState(controller.syncState).status).toBe(`offline`)
		expect($.getState(controller.syncState).revision).toBe(0)
		expect($.getState(controller.syncState).pending).toEqual([])
		expect($.getState(controller.syncState).presence).toEqual([])
		expect($.getState(controller.syncState).problem).toBeNull()
	})

	it(`publishes each synchronization transition as one coherent observation`, () => {
		const { $, controller, socket } = setup(`coherent-sync-state`, true)
		const syncSummarySelector = $.selector<string>({
			key: `syncSummary`,
			get: ({ get }) => {
				const state = get(controller.syncState)
				return [
					state.status,
					state.revision,
					state.pending.join(`,`),
					state.presence.length,
					state.problem?.kind ?? `clear`,
				].join(`|`)
			},
		})
		expect($.getState(syncSummarySelector)).toBe(`syncing|0||0|clear`)
		const stateUpdates = vitest.fn()
		const summaryUpdates = vitest.fn()
		$.subscribe(controller.syncState, stateUpdates)
		$.subscribe(syncSummarySelector, summaryUpdates)

		socket.receive(MOSAIC_EVENTS.snapshot, snapshot(controller, { revision: 4 }))

		expect(stateUpdates).toHaveBeenCalledTimes(1)
		expect(stateUpdates).toHaveBeenLastCalledWith({
			oldValue: {
				pending: [],
				presence: [],
				problem: null,
				revision: 0,
				status: `syncing`,
			},
			newValue: {
				pending: [],
				presence: [],
				problem: null,
				revision: 4,
				status: `live`,
			},
		})
		expect(summaryUpdates).toHaveBeenCalledTimes(1)
		expect(summaryUpdates).toHaveBeenLastCalledWith({
			oldValue: `syncing|0||0|clear`,
			newValue: `live|4||0|clear`,
		})
	})

	it(`shares companion families across sessions and diagnoses key collisions`, () => {
		const $ = new Silo(storeConfig(`companion-families`))
		const notesAtom = $.mutableAtom<TextTransceiver>({
			key: `notes`,
			class: Text,
		})
		const first = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			session: `first-tab`,
		})
		const second = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			session: `second-tab`,
		})
		expect(first.syncState.family?.key).toBe(second.syncState.family?.key)
		expect(first.syncState.key).not.toBe(second.syncState.key)

		const collision = new Silo(storeConfig(`companion-collision`))
		collision.selectorFamily<readonly string[], string>({
			key: `🔶mosaic:sync-state`,
			get: () => () => [] as readonly string[],
		})
		const collisionNotesAtom = collision.mutableAtom<TextTransceiver>({
			key: `collisionNotes`,
			class: Text,
		})
		expect(() =>
			syncMosaic(collision.store, collisionNotesAtom, {
				actor: `alice`,
				session: `tab`,
			}),
		).toThrow(`companion key`)
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
		expect($.getState(controller.syncState).pending).toEqual([`operation-0`])
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
		expect($.getState(controller.syncState).revision).toBe(1)
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
		expect($.getState(controller.syncState).pending).toEqual([`operation-0`])
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
		expect($.getState(controller.syncState).pending).toEqual([])
		expect(socket.sent(MOSAIC_EVENTS.operation)).toEqual([])

		const commitTransaction = $.transaction<() => void>({
			key: `commit`,
			do: () => {
				controller.change({ text: `first`, type: `replace-text` })
				controller.change({ text: `committed`, type: `replace-text` })
			},
		})
		$.runTransaction(commitTransaction)()

		expect($.getState(controller.syncState).pending).toEqual([
			`operation-1`,
			`operation-2`,
		])
		const committed = socket.sent<MosaicOperationProposal<MosaicTextOperation>>(
			MOSAIC_EVENTS.operation,
		)
		expect(committed).toHaveLength(2)
		expect(committed[1]?.dependencies).toEqual([`operation-1`])
	})

	it(`seeds and replaces the frontier while preserving pending causality`, () => {
		const { controller, socket } = setup(`snapshot-frontier`, true)
		socket.receive(
			MOSAIC_EVENTS.snapshot,
			snapshot(controller, {
				headOperationIds: [`checkpoint-b`, `checkpoint-a`],
				revision: 4,
			}),
		)

		controller.change({ text: `first`, type: `replace-text` })
		let proposals = socket.sent<MosaicOperationProposal<MosaicTextOperation>>(
			MOSAIC_EVENTS.operation,
		)
		expect(proposals.at(-1)?.dependencies).toEqual([
			`checkpoint-a`,
			`checkpoint-b`,
		])
		controller.change({ text: `second`, type: `replace-text` })
		proposals = socket.sent<MosaicOperationProposal<MosaicTextOperation>>(
			MOSAIC_EVENTS.operation,
		)
		expect(proposals.at(-1)?.dependencies).toEqual([`operation-0`])
		const first = proposals[0]
		if (first === undefined) throw new Error(`Expected the first proposal`)
		const checkpoint = new Text()
		checkpoint.do({
			actor: controller.actor,
			dependencies: first.dependencies,
			group: first.group,
			id: first.id,
			operation: first.operation,
			revision: 5,
			session: first.session,
		})

		socket.receive(
			MOSAIC_EVENTS.snapshot,
			snapshot(controller, {
				acceptedPendingOperationIds: [`operation-0`],
				headOperationIds: [`replacement-head`],
				revision: 5,
				snapshot: checkpoint.toJSON(),
			}),
		)
		controller.change({ text: `third`, type: `replace-text` })
		proposals = socket.sent<MosaicOperationProposal<MosaicTextOperation>>(
			MOSAIC_EVENTS.operation,
		)
		expect(proposals.at(-1)?.dependencies).toEqual([
			`operation-1`,
			`replacement-head`,
		])
	})

	it(`requires the complete configured model and directs mismatches to upgrade`, () => {
		const { $, controller, socket } = setup(`model-configuration`, true)
		const configured = {
			initialText: ``,
			maximumDeletionIntervalsPerOperation: 16_384,
			maximumHistoryTargets: 10_000,
			maximumRunGraphemes: 200_000,
			maximumRunUtf16Units: 4_000_000,
			maximumRunsPerOperation: 16,
		} as const
		expect(Text.mosaic.configuration).toEqual(configured)
		socket.receive(
			MOSAIC_EVENTS.snapshot,
			snapshot(controller, {
				model: {
					configuration: {
						...configured,
					},
					key: Text.mosaic.key,
					version: Text.mosaic.version,
				},
			}),
		)
		expect($.getState(controller.syncState).status).toBe(`live`)
		controller.change({ text: `pending`, type: `replace-text` })

		socket.receive(
			MOSAIC_EVENTS.snapshot,
			snapshot(controller, {
				model: {
					configuration: {
						...configured,
						maximumRunGraphemes: configured.maximumRunGraphemes + 1,
					},
					key: Text.mosaic.key,
					version: Text.mosaic.version,
				},
			}),
		)

		expect($.getState(controller.syncState).status).toBe(`rejected`)
		expect($.getState(controller.syncState).pending).toEqual([])
		expect($.getState(controller.syncState).problem).toMatchObject({
			code: `incompatible-version`,
			discarded: [{ id: `operation-0` }],
			kind: `rejection`,
			operationId: null,
			recovery: `upgrade`,
		})
	})

	it(`rejects accepted operations from a differently configured model`, () => {
		const { $, controller, socket } = setup(`operation-model`, true)
		hydrate(controller, socket)
		controller.change({ text: `pending`, type: `replace-text` })
		const incompatible = proposal(controller, `remote`, `remote-operation`)

		socket.receive(MOSAIC_EVENTS.operation, {
			...incompatible,
			operation: {
				...incompatible.operation,
				model: {
					configuration: {
						initialText: `seed`,
						maximumDeletionIntervalsPerOperation: 16_384,
						maximumHistoryTargets: 10_000,
						maximumRunGraphemes: 200_000,
						maximumRunUtf16Units: 4_000_000,
						maximumRunsPerOperation: 16,
					},
					key: Text.mosaic.key,
					version: Text.mosaic.version,
				},
			},
		})

		expect($.getState(controller.syncState).status).toBe(`rejected`)
		expect($.getState(controller.syncState).problem).toMatchObject({
			code: `incompatible-version`,
			discarded: [{ id: `operation-0` }],
			kind: `rejection`,
			recovery: `upgrade`,
		})
	})

	it(`recovers from malformed, invalid, and duplicate accepted operations`, () => {
		const malformed = setup(`malformed-operation`, true)
		hydrate(malformed.controller, malformed.socket)
		malformed.controller.change({ text: `pending`, type: `replace-text` })
		malformed.socket.receive(MOSAIC_EVENTS.operation, null)
		expect(malformed.$.getState(malformed.controller.syncState).status).toBe(
			`recovering`,
		)
		expect(malformed.$.getState(malformed.controller.syncState).pending).toEqual(
			[],
		)

		const invalidRevision = setup(`invalid-revision`, true)
		hydrate(invalidRevision.controller, invalidRevision.socket)
		invalidRevision.socket.receive(MOSAIC_EVENTS.operation, {
			...proposal(invalidRevision.controller, `remote`, `invalid-revision`),
			revision: 0,
		})
		expect(
			invalidRevision.$.getState(invalidRevision.controller.syncState).status,
		).toBe(`recovering`)

		const invalidOperation = setup(`invalid-operation`, true)
		hydrate(invalidOperation.controller, invalidOperation.socket)
		const invalid = proposal(
			invalidOperation.controller,
			`remote`,
			`invalid-operation`,
		)
		invalidOperation.socket.receive(MOSAIC_EVENTS.operation, {
			...invalid,
			operation: { ...invalid.operation, operation: { type: `unknown` } },
		})
		expect(
			invalidOperation.$.getState(invalidOperation.controller.syncState).status,
		).toBe(`recovering`)

		const duplicate = setup(`duplicate-accepted`, true)
		hydrate(duplicate.controller, duplicate.socket)
		const accepted = proposal(duplicate.controller, `remote`, `duplicate`)
		duplicate.socket.receive(MOSAIC_EVENTS.operation, accepted)
		duplicate.socket.receive(MOSAIC_EVENTS.operation, {
			...accepted,
			revision: 2,
		})
		expect(duplicate.$.getState(duplicate.controller.syncState).status).toBe(
			`recovering`,
		)
		expect(
			duplicate.$.getState(duplicate.controller.syncState).problem,
		).toMatchObject({
			kind: `protocol`,
			reason: expect.stringContaining(`more than one revision`),
		})
	})

	it(`ignores foreign accepted operations and stale duplicate delivery`, () => {
		const { $, controller, socket } = setup(`accepted-routing`, true)
		hydrate(controller, socket)
		const foreign = proposal(controller, `foreign`, `foreign`)
		socket.receive(MOSAIC_EVENTS.operation, {
			...foreign,
			operation: {
				...foreign.operation,
				atom: { ...controller.address, key: `another-atom` },
			},
		})
		expect($.getState(controller.syncState).revision).toBe(0)

		controller.change({ text: `accepted`, type: `replace-text` })
		const [local] = socket.sent<MosaicOperationProposal<MosaicTextOperation>>(
			MOSAIC_EVENTS.operation,
		)
		if (local === undefined) throw new Error(`Expected a local proposal`)
		const accepted = { operation: { ...local, actor: `alice` }, revision: 1 }
		socket.receive(MOSAIC_EVENTS.operation, accepted)
		socket.receive(MOSAIC_EVENTS.operation, accepted)
		expect($.getState(controller.syncState).pending).toEqual([])
		expect($.getState(controller.syncState).status).toBe(`live`)
	})

	it(`does not treat a stale matching ID as acknowledgement`, () => {
		const { $, controller, socket } = setup(`stale-forged-ack`, true)
		hydrate(controller, socket)
		socket.receive(
			MOSAIC_EVENTS.operation,
			proposal(controller, `confirmed`, `confirmed`),
		)
		controller.change({ text: `ours`, type: `replace-text` })
		const local = socket
			.sent<MosaicOperationProposal<MosaicTextOperation>>(
				MOSAIC_EVENTS.operation,
			)
			.at(-1)
		if (local === undefined) throw new Error(`Expected a local proposal`)

		socket.receive(MOSAIC_EVENTS.operation, {
			operation: local,
			revision: 1,
		})

		expect($.getState(controller.syncState)).toMatchObject({
			pending: [`operation-0`],
			revision: 1,
			status: `live`,
		})
	})

	it(`recovers when a transceiver does not apply an operation atomically`, () => {
		const NonAtomicText = class extends Text {
			public static override fromJSON(
				snapshotValue: ReturnType<TextTransceiver[`toJSON`]>,
			): TextTransceiver {
				const transceiver = Text.fromJSON(snapshotValue)
				Object.defineProperty(transceiver, `do`, {
					value: () => ({ partial: true }),
				})
				return transceiver
			}
		}
		const $ = new Silo(storeConfig(`non-atomic-transceiver`))
		const notesAtom = $.mutableAtom<TextTransceiver>({
			key: `notes`,
			class: NonAtomicText,
		})
		const socket = new ControlledTransport(true)
		const controller = syncMosaic<TextTransceiver, { cursor: number }>(
			$.store,
			notesAtom,
			{
				actor: `alice`,
				session: `alice-tab`,
				transport: socket,
			},
		)
		socket.receive(MOSAIC_EVENTS.snapshot, snapshot(controller))

		socket.receive(
			MOSAIC_EVENTS.operation,
			proposal(controller, `remote`, `remote`),
		)

		expect($.getState(controller.syncState).status).toBe(`recovering`)
		expect($.getState(controller.syncState).problem).toMatchObject({
			kind: `protocol`,
			reason: expect.stringContaining(`did not apply atomically`),
		})
	})

	it(`exposes stamped presence envelopes through companion state`, () => {
		const { $, controller, socket } = setup(`presence`, true)
		hydrate(controller, socket)

		socket.receive(MOSAIC_EVENTS.presence, {
			actor: `bob`,
			atom: controller.address,
			presence: { cursor: 4 },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: `bob-tab`,
		})

		expect($.getState(controller.syncState).presence).toEqual([
			{
				actor: `bob`,
				atom: controller.address,
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
		expect($.getState(controller.syncState).status).toBe(`syncing`)
		hydrate(controller, socket)
		expect(socket.sent(MOSAIC_EVENTS.operation)).toHaveLength(3)

		socket.receive(`disconnect`)
		expect($.getState(controller.syncState).status).toBe(`offline`)
		expect($.getState(controller.syncState).presence).toEqual([])
		socket.receive(`connect`)
		expect($.getState(controller.syncState).status).toBe(`syncing`)
		expect(socket.sent(MOSAIC_EVENTS.join).length).toBeGreaterThanOrEqual(3)
	})

	it(`replaces transports idempotently and blocks reconnection after disposal`, () => {
		const { $, controller, socket } = setup(`transport-replacement`, true)
		hydrate(controller, socket)
		controller.publishPresence({ cursor: 2 })
		const replacement = new ControlledTransport(true)

		const disconnectReplacement = controller.connect(replacement)
		expect($.getState(controller.syncState).status).toBe(`syncing`)
		expect(socket.sent(MOSAIC_EVENTS.presence).at(-1)).toMatchObject({
			presence: null,
		})
		socket.receive(`disconnect`)
		expect($.getState(controller.syncState).status).toBe(`syncing`)

		disconnectReplacement()
		disconnectReplacement()
		expect($.getState(controller.syncState).status).toBe(`offline`)
		controller.dispose()
		expect(() => controller.connect(new ControlledTransport())).toThrow(
			`Cannot connect a disposed Mosaic`,
		)
	})

	it(`sorts and removes per-session presence while ignoring malformed peers`, () => {
		const { $, controller, socket } = setup(`presence-lifecycle`, true)
		hydrate(controller, socket)
		const presence = (
			actor: string,
			session: string,
			cursor: number | null,
		) => ({
			actor,
			atom: controller.address,
			presence: cursor === null ? null : { cursor },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session,
		})

		socket.receive(MOSAIC_EVENTS.presence, presence(`bob`, `two`, 2))
		socket.receive(MOSAIC_EVENTS.presence, presence(`alice`, `two`, 1))
		socket.receive(MOSAIC_EVENTS.presence, presence(`bob`, `one`, 3))
		expect(
			$.getState(controller.syncState).presence.map(({ actor, session }) => [
				actor,
				session,
			]),
		).toEqual([
			[`alice`, `two`],
			[`bob`, `one`],
			[`bob`, `two`],
		])

		socket.receive(MOSAIC_EVENTS.presence, presence(`bob`, `one`, null))
		socket.receive(MOSAIC_EVENTS.presence, {
			...presence(`bob`, `invalid`, 9),
			protocolVersion: 99,
		})
		socket.receive(MOSAIC_EVENTS.presence, null)
		expect(
			$.getState(controller.syncState).presence.map(({ actor, session }) => [
				actor,
				session,
			]),
		).toEqual([
			[`alice`, `two`],
			[`bob`, `two`],
		])
	})

	it(`rejects authoritative tracker injection and deduplicates local signals`, () => {
		const injected = setup(`tracker-injection`)
		const authoritative = new Text().change(
			{ text: `authority`, type: `replace-text` },
			{
				actor: `mallory`,
				dependencies: [],
				group: null,
				id: `forged`,
				now: 1_000,
				revision: null,
				session: `mallory-tab`,
			},
		)
		if (authoritative === null) throw new Error(`Expected an injected signal`)
		setIntoStore(
			injected.$.store,
			getUpdateToken(injected.notesAtom),
			authoritative,
		)
		expect(injected.$.getState(injected.controller.syncState).status).toBe(
			`rejected`,
		)
		expect(
			injected.$.getState(injected.controller.syncState).problem,
		).toMatchObject({
			kind: `protocol`,
			reason: expect.stringContaining(`foreign or authoritative`),
		})

		const duplicate = setup(`tracker-duplicate`)
		const local = new Text().change(
			{ text: `once`, type: `replace-text` },
			{
				actor: duplicate.controller.actor,
				dependencies: [],
				group: null,
				id: `same-signal`,
				now: 1_000,
				revision: null,
				session: duplicate.controller.session,
			},
		)
		if (local === null) throw new Error(`Expected a local signal`)
		setIntoStore(duplicate.$.store, getUpdateToken(duplicate.notesAtom), local)
		setIntoStore(duplicate.$.store, getUpdateToken(duplicate.notesAtom), local)
		expect(duplicate.$.getState(duplicate.controller.syncState).pending).toEqual(
			[`same-signal`],
		)
	})

	it(`quarantines a rejected causal chain and exposes recovery`, () => {
		const { $, controller, socket } = setup(`rejection`, true)
		hydrate(controller, socket)
		controller.change({ text: `first`, type: `replace-text` })
		controller.change({ text: `second`, type: `replace-text` })

		socket.receive(MOSAIC_EVENTS.rejection, {
			atom: controller.address,
			code: `invalid-model-operation`,
			operationId: `operation-0`,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `invalid`,
			recovery: `discard-operation`,
			session: controller.session,
		})

		expect($.getState(controller.syncState).pending).toEqual([])
		expect($.getState(controller.syncState).problem).toMatchObject({
			discarded: [{ id: `operation-0` }, { id: `operation-1` }],
			kind: `rejection`,
			recovery: `discard-operation`,
		})
		expect($.getState(controller.syncState).status).toBe(`live`)
		controller.clearProblem()
		expect($.getState(controller.syncState).problem).toBeNull()
	})

	it(`fails closed for terminal rejections`, () => {
		const { $, controller, socket } = setup(`terminal-rejection`, true)
		hydrate(controller, socket)
		controller.change({ text: `pending`, type: `replace-text` })

		socket.receive(MOSAIC_EVENTS.rejection, {
			atom: controller.address,
			code: `unauthorized`,
			operationId: null,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `no access`,
			recovery: `none`,
			session: controller.session,
		})

		expect($.getState(controller.syncState).status).toBe(`rejected`)
		expect($.getState(controller.syncState).pending).toEqual([])
		expect(
			controller.change({ text: `blocked`, type: `replace-text` }),
		).toBeNull()
	})

	it(`honors retry and resnapshot rejection recovery without losing outbox`, () => {
		const retry = setup(`retry-rejection`, true)
		hydrate(retry.controller, retry.socket)
		retry.controller.change({ text: `pending`, type: `replace-text` })
		retry.socket.receive(MOSAIC_EVENTS.rejection, {
			atom: retry.controller.address,
			code: `capacity-exceeded`,
			operationId: `operation-0`,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `try later`,
			recovery: `retry`,
			session: retry.controller.session,
		})
		expect(retry.$.getState(retry.controller.syncState).pending).toEqual([
			`operation-0`,
		])
		expect(retry.$.getState(retry.controller.syncState).problem).toMatchObject({
			discarded: [],
			recovery: `retry`,
		})
		retry.controller.retryPending()
		expect(retry.socket.sent(MOSAIC_EVENTS.operation)).toHaveLength(2)

		const resnapshot = setup(`resnapshot-rejection`, true)
		hydrate(resnapshot.controller, resnapshot.socket)
		resnapshot.controller.change({ text: `pending`, type: `replace-text` })
		resnapshot.socket.receive(MOSAIC_EVENTS.rejection, {
			atom: resnapshot.controller.address,
			code: `missing-dependency`,
			operationId: `operation-0`,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `checkpoint required`,
			recovery: `resnapshot`,
			session: resnapshot.controller.session,
		})
		expect(resnapshot.$.getState(resnapshot.controller.syncState).status).toBe(
			`recovering`,
		)
		expect(
			resnapshot.$.getState(resnapshot.controller.syncState).pending,
		).toEqual([`operation-0`])
		expect(resnapshot.socket.sent(MOSAIC_EVENTS.join).at(-1)).toMatchObject({
			pendingOperationIds: [`operation-0`],
		})
	})

	it(`quarantines stale history before requesting a checkpoint`, () => {
		const { $, controller, socket } = setup(`stale-history`, true)
		hydrate(controller, socket)
		controller.change({ text: `first`, type: `replace-text` })
		controller.change({ text: `second`, type: `replace-text` })

		socket.receive(MOSAIC_EVENTS.rejection, {
			atom: controller.address,
			code: `stale-history`,
			operationId: `operation-0`,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `history changed`,
			recovery: `resnapshot`,
			session: controller.session,
		})

		expect($.getState(controller.syncState).status).toBe(`recovering`)
		expect($.getState(controller.syncState).pending).toEqual([])
		expect($.getState(controller.syncState).problem).toMatchObject({
			discarded: [{ id: `operation-0` }, { id: `operation-1` }],
			recovery: `resnapshot`,
		})
	})

	it(`isolates rejection routing and fails closed on malformed rejection`, () => {
		const { $, controller, socket } = setup(`rejection-routing`, true)
		hydrate(controller, socket)
		controller.change({ text: `pending`, type: `replace-text` })
		const rejection = {
			atom: controller.address,
			code: `invalid-model-operation`,
			operationId: `operation-0`,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `invalid`,
			recovery: `discard-operation`,
			session: controller.session,
		} as const

		socket.receive(MOSAIC_EVENTS.rejection, {
			...rejection,
			session: `another-session`,
		})
		socket.receive(MOSAIC_EVENTS.rejection, {
			...rejection,
			operationId: `unknown-operation`,
		})
		socket.receive(MOSAIC_EVENTS.rejection, {
			...rejection,
			atom: { ...controller.address, key: `another-atom` },
		})
		expect($.getState(controller.syncState).pending).toEqual([`operation-0`])
		expect($.getState(controller.syncState).problem).toBeNull()

		socket.receive(MOSAIC_EVENTS.rejection, {
			...rejection,
			code: `not-a-code`,
		})
		expect($.getState(controller.syncState).status).toBe(`rejected`)
		expect($.getState(controller.syncState).problem).toMatchObject({
			kind: `protocol`,
		})

		const notAnEnvelope = setup(`non-envelope-rejection`, true)
		notAnEnvelope.socket.receive(MOSAIC_EVENTS.rejection, null)
		expect(
			notAnEnvelope.$.getState(notAnEnvelope.controller.syncState).status,
		).toBe(`rejected`)
	})

	it(`recovers revision gaps with a fresh join`, () => {
		const { $, controller, socket } = setup(`gap`, true)
		hydrate(controller, socket)
		const skipped = proposal(controller, `future`, `future`)

		socket.receive(MOSAIC_EVENTS.operation, { ...skipped, revision: 2 })

		expect($.getState(controller.syncState).status).toBe(`recovering`)
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

		expect($.getState(controller.syncState).status).toBe(`rejected`)
		expect($.getState(controller.syncState).problem).toMatchObject({
			kind: `protocol`,
		})
		controller.clearProblem()
		expect($.getState(controller.syncState).problem).toBeNull()
	})

	it(`isolates snapshots by atom and session and ignores older checkpoints`, () => {
		const { $, controller, socket } = setup(`snapshot-routing`, true)
		socket.receive(MOSAIC_EVENTS.snapshot, snapshot(controller, { revision: 2 }))
		socket.receive(MOSAIC_EVENTS.snapshot, {
			...snapshot(controller, { revision: 3 }),
			session: `another-session`,
		})
		socket.receive(MOSAIC_EVENTS.snapshot, {
			...snapshot(controller, { revision: 3 }),
			atom: { ...controller.address, key: `another-atom` },
		})
		socket.receive(MOSAIC_EVENTS.snapshot, snapshot(controller, { revision: 1 }))

		expect($.getState(controller.syncState).revision).toBe(2)
		expect($.getState(controller.syncState).status).toBe(`live`)
	})

	it(`fails closed on duplicate heads and unhydratable checkpoints`, () => {
		const duplicateHeads = setup(`duplicate-heads`, true)
		duplicateHeads.socket.receive(
			MOSAIC_EVENTS.snapshot,
			snapshot(duplicateHeads.controller, {
				headOperationIds: [`same`, `same`],
			}),
		)
		expect(
			duplicateHeads.$.getState(duplicateHeads.controller.syncState).status,
		).toBe(`rejected`)

		const invalidState = setup(`invalid-snapshot-state`, true)
		invalidState.socket.receive(MOSAIC_EVENTS.snapshot, {
			...snapshot(invalidState.controller),
			snapshot: {},
		})
		expect(
			invalidState.$.getState(invalidState.controller.syncState).status,
		).toBe(`rejected`)
		expect(
			invalidState.$.getState(invalidState.controller.syncState).problem,
		).toMatchObject({
			kind: `protocol`,
			reason: expect.stringContaining(`could not be hydrated`),
		})

		const missingEnvelope = setup(`missing-snapshot-envelope`, true)
		missingEnvelope.socket.receive(MOSAIC_EVENTS.snapshot, null)
		expect(
			missingEnvelope.$.getState(missingEnvelope.controller.syncState).status,
		).toBe(`rejected`)
	})

	it(`canonicalizes nested model configuration independent of key order`, () => {
		const RichText = class extends Text {}
		const configuration = {
			array: [null, true, false, 3, `three`, { left: 1, right: 2 }],
			nested: { enabled: true, limit: 4 },
		} as const
		Object.defineProperty(RichText, `mosaic`, {
			value: { configuration, key: `rich-text`, version: 1 },
		})
		const $ = new Silo(storeConfig(`canonical-model`))
		const notesAtom = $.mutableAtom<TextTransceiver>({
			key: `notes`,
			class: RichText,
		})
		const socket = new ControlledTransport(true)
		const controller = syncMosaic($.store, notesAtom, {
			actor: `alice`,
			session: `alice-tab`,
			transport: socket,
		})

		socket.receive(MOSAIC_EVENTS.snapshot, {
			acceptedPendingOperationIds: [],
			atom: controller.address,
			headOperationIds: [],
			model: {
				configuration: {
					nested: { limit: 4, enabled: true },
					array: [null, true, false, 3, `three`, { right: 2, left: 1 }],
				},
				key: `rich-text`,
				version: 1,
			},
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			revision: 0,
			session: controller.session,
			snapshot: new RichText().toJSON(),
		})

		expect($.getState(controller.syncState).status).toBe(`live`)
	})

	it(`rejects missing and non-JSON model configuration safely`, () => {
		const missing = setup(`missing-model-config`, true)
		missing.socket.receive(MOSAIC_EVENTS.snapshot, {
			...snapshot(missing.controller),
			model: { key: Text.mosaic.key, version: Text.mosaic.version },
		})
		expect(
			missing.$.getState(missing.controller.syncState).problem,
		).toMatchObject({
			code: `incompatible-version`,
			recovery: `upgrade`,
		})

		const nonJson = setup(`non-json-model-config`, true)
		nonJson.socket.receive(MOSAIC_EVENTS.snapshot, {
			...snapshot(nonJson.controller),
			model: {
				configuration: Number.NaN,
				key: Text.mosaic.key,
				version: Text.mosaic.version,
			},
		})
		expect(
			nonJson.$.getState(nonJson.controller.syncState).problem,
		).toMatchObject({
			kind: `protocol`,
		})
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

		expect(controller.address).toEqual({
			family: { key: `notes`, subKey: `"one"` },
			key: `notes("one")`,
			type: `mutable_atom`,
		})

		$.disposeState(notesAtoms, `one`)
		expect($.store.miscResources.size).toBe(0)
	})

	it(`removes Store-owned resources and companion members on disposal`, () => {
		const { $, controller } = setup(`disposal`)
		const companionKeys = [controller.syncState].map(({ key }) => key)

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

		expect($.getState(controller.syncState).pending).toEqual([])
		expect($.getState(controller.syncState).revision).toBe(1)
	})
})
