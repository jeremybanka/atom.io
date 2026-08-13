import type { Json } from "atom.io/foundations/json"
import {
	defineMosaicModel,
	defineMosaicResource,
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicAcceptedOperationEnvelope,
	type MosaicOperationMetadata,
	type MosaicRejectionEnvelope,
	type MosaicSnapshotEnvelope,
	type Socket,
	type StandardSchemaV1,
} from "atom.io/realtime"
import {
	createMosaicServer,
	defineMosaicServerResource,
	InMemoryMosaicStorage,
} from "atom.io/realtime-server"
import { createRestartableServerFixture } from "atom.io/realtime-testing"

type Add = { readonly amount: number; readonly kind: `add` }
type History = {
	readonly kind: `history`
	readonly mode: `redo` | `undo`
	readonly targetOperationIds: readonly string[]
}
type CounterOperation = Add | History
type CounterEntry = MosaicOperationMetadata & {
	readonly operation: CounterOperation
}
type CounterState = {
	readonly active: Readonly<Record<string, boolean>>
	readonly entries: readonly CounterEntry[]
}

const emptyState = (): CounterState => ({ active: {}, entries: [] })

const counterModel = defineMosaicModel({
	apply: (
		state: CounterState,
		operation: CounterOperation,
		context: MosaicOperationMetadata,
	): CounterState => {
		const active = { ...state.active }
		if (operation.kind === `add`) active[context.id] = true
		else {
			for (const id of operation.targetOperationIds) {
				active[id] = operation.mode === `redo`
			}
		}
		return {
			active,
			entries: [...state.entries, { ...context, operation }],
		}
	},
	create: emptyState,
	hydrate: (snapshot: CounterState): CounterState => structuredClone(snapshot),
	key: `test-counter`,
	prepare: (_state: CounterState, intent: CounterOperation): CounterOperation =>
		intent,
	snapshot: (state: CounterState): CounterState => structuredClone(state),
	validate: (
		_state: CounterState,
		operation: CounterOperation,
	): { readonly operation: CounterOperation; readonly status: `accept` } => ({
		operation,
		status: `accept`,
	}),
	version: 1,
})

const operationSchema: StandardSchemaV1<unknown, CounterOperation> = {
	"~standard": {
		validate: (value): StandardSchemaV1.Result<CounterOperation> => {
			if (
				typeof value === `object` &&
				value !== null &&
				((Reflect.get(value, `kind`) === `add` &&
					typeof Reflect.get(value, `amount`) === `number`) ||
					(Reflect.get(value, `kind`) === `history` &&
						(Reflect.get(value, `mode`) === `undo` ||
							Reflect.get(value, `mode`) === `redo`) &&
						Array.isArray(Reflect.get(value, `targetOperationIds`))))
			) {
				return { value: value as CounterOperation }
			}
			return { issues: [{ message: `Expected a counter operation.` }] }
		},
		vendor: `test`,
		version: 1,
	},
}

const presenceSchema: StandardSchemaV1<unknown, { readonly cursor: number }> = {
	"~standard": {
		validate: (value): StandardSchemaV1.Result<{ readonly cursor: number }> =>
			typeof value === `object` &&
			value !== null &&
			typeof Reflect.get(value, `cursor`) === `number`
				? { value: value as { readonly cursor: number } }
				: { issues: [{ message: `Expected presence.` }] },
		vendor: `test`,
		version: 1,
	},
}

const timeline = (state: CounterState, actor: string) => {
	const undo: Array<{ group: string; operationIds: string[] }> = []
	const redo: Array<{ group: string; operationIds: string[] }> = []
	for (const entry of state.entries) {
		if (entry.actor !== actor) continue
		if (entry.operation.kind === `add`) {
			const previous = undo.at(-1)
			if (entry.group !== null && previous?.group === entry.group) {
				previous.operationIds.push(entry.id)
			} else {
				undo.push({ group: entry.group ?? entry.id, operationIds: [entry.id] })
			}
			redo.length = 0
			continue
		}
		const from = entry.operation.mode === `undo` ? undo : redo
		const to = entry.operation.mode === `undo` ? redo : undo
		const targetOperationIds = entry.operation.targetOperationIds
		const expected = from.at(-1)
		if (
			expected &&
			expected.operationIds.length === targetOperationIds.length &&
			expected.operationIds.every(
				(id, index) => id === targetOperationIds[index],
			)
		) {
			from.pop()
			to.push(expected)
		}
	}
	return { redo, undo }
}

const resource = defineMosaicServerResource({
	...defineMosaicResource({ key: `counter`, model: counterModel }),
	checkpointEvery: 2,
	history: {
		request: (operation: CounterOperation) =>
			operation.kind === `history`
				? {
						mode: operation.mode,
						targetOperationIds: operation.targetOperationIds,
					}
				: null,
		timeline,
	},
	operationSchema,
	presenceSchema,
})

class TestSocket implements Socket {
	public readonly emitted: Array<readonly [string, Json.Serializable]> = []
	public readonly id: string
	readonly #listeners = new Map<
		string,
		Set<(...args: Json.Serializable[]) => void>
	>()

	public constructor(id: string) {
		this.id = id
	}

	public clientEmit(event: string, payload: Json.Serializable): void {
		for (const listener of this.#listeners.get(event) ?? []) listener(payload)
	}

	public emit = (event: string, ...args: Json.Serializable[]): void => {
		this.emitted.push([event, args[0] ?? null])
	}

	public off = (
		event: string,
		listener?: (...args: Json.Serializable[]) => void,
	): void => {
		if (listener === undefined) this.#listeners.delete(event)
		else this.#listeners.get(event)?.delete(listener)
	}

	public offAny = (): void => {}

	public on = (
		event: string,
		listener: (...args: Json.Serializable[]) => void,
	): void => {
		const listeners = this.#listeners.get(event) ?? new Set()
		listeners.add(listener)
		this.#listeners.set(event, listeners)
	}

	public onAny = (): void => {}

	public onAnyOutgoing = (): void => {}

	public values(event: string): Json.Serializable[] {
		return this.emitted
			.filter(([emitted]) => emitted === event)
			.map(([, payload]) => payload)
	}
}

const join = (
	socket: TestSocket,
	session: string,
	pending: string[] = [],
): void => {
	socket.clientEmit(MOSAIC_EVENTS.join, {
		knownRevision: null,
		model: { key: counterModel.key, version: counterModel.version },
		pendingOperationIds: pending,
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		resource: resource.key,
		session,
	})
}

const propose = (
	socket: TestSocket,
	session: string,
	id: string,
	operation: CounterOperation,
	dependencies: string[] = [],
): void => {
	socket.clientEmit(MOSAIC_EVENTS.operation, {
		dependencies,
		group: operation.kind === `add` ? `typing` : null,
		id,
		model: { key: counterModel.key, version: counterModel.version },
		operation,
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		resource: resource.key,
		session,
	})
}

const waitForValues = async (
	socket: TestSocket,
	event: string,
	length: number,
): Promise<Json.Serializable[]> => {
	await vi.waitFor(() => {
		expect(socket.values(event)).toHaveLength(length)
	})
	return socket.values(event)
}

describe(`Mosaic server`, () => {
	test(`stamps authorship, persists before broadcast, and handles duplicate ids`, async () => {
		const storage = new InMemoryMosaicStorage()
		const server = createMosaicServer({ resources: [resource], storage })
		const socket = new TestSocket(`alice-socket`)
		const disconnect = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket,
		})
		join(socket, `alice-session`)
		await waitForValues(socket, MOSAIC_EVENTS.snapshot, 1)

		propose(socket, `alice-session`, `alice:1`, { amount: 2, kind: `add` })
		const [accepted] = (await waitForValues(
			socket,
			MOSAIC_EVENTS.operation,
			1,
		)) as unknown as MosaicAcceptedOperationEnvelope<CounterOperation>[]
		expect(accepted?.operation.actor).toBe(`alice`)
		expect(accepted?.operation.session).toBe(`alice-session`)
		expect((await storage.recover(resource.key)).headRevision).toBe(1)

		propose(socket, `alice-session`, `alice:1`, { amount: 2, kind: `add` })
		await waitForValues(socket, MOSAIC_EVENTS.operation, 2)
		expect((await storage.recover(resource.key)).headRevision).toBe(1)

		propose(socket, `alice-session`, `alice:1`, { amount: 3, kind: `add` })
		const [collision] = (await waitForValues(
			socket,
			MOSAIC_EVENTS.rejection,
			1,
		)) as unknown as MosaicRejectionEnvelope[]
		expect(collision?.code).toBe(`operation-id-collision`)

		propose(socket, `alice-session`, `alice:2`, { amount: 1, kind: `add` }, [
			`missing`,
		])
		const rejections = (await waitForValues(
			socket,
			MOSAIC_EVENTS.rejection,
			2,
		)) as unknown as MosaicRejectionEnvelope[]
		expect(rejections.at(-1)?.code).toBe(`missing-dependency`)

		await disconnect()
		await server.dispose()
	})

	test(`enforces the authenticated actor's selective-history cursor`, async () => {
		const server = createMosaicServer({ resources: [resource] })
		const socket = new TestSocket(`alice-socket`)
		const disconnect = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket,
		})
		join(socket, `alice-session`)
		await waitForValues(socket, MOSAIC_EVENTS.snapshot, 1)
		propose(socket, `alice-session`, `alice:1`, { amount: 1, kind: `add` })
		await waitForValues(socket, MOSAIC_EVENTS.operation, 1)
		propose(socket, `alice-session`, `alice:undo`, {
			kind: `history`,
			mode: `undo`,
			targetOperationIds: [`alice:1`],
		})
		await waitForValues(socket, MOSAIC_EVENTS.operation, 2)
		propose(socket, `alice-session`, `alice:stale-undo`, {
			kind: `history`,
			mode: `undo`,
			targetOperationIds: [`alice:1`],
		})
		const [rejection] = (await waitForValues(
			socket,
			MOSAIC_EVENTS.rejection,
			1,
		)) as unknown as MosaicRejectionEnvelope[]
		expect(rejection?.code).toBe(`stale-history`)
		await disconnect()
		await server.dispose()
	})

	test(`presence is ephemeral and removed on disconnect`, async () => {
		const server = createMosaicServer({ resources: [resource] })
		const alice = new TestSocket(`alice-socket`)
		const bob = new TestSocket(`bob-socket`)
		const disconnectAlice = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket: alice,
		})
		const disconnectBob = server.connect({
			actor: `bob`,
			session: `bob-session`,
			socket: bob,
		})
		join(alice, `alice-session`)
		join(bob, `bob-session`)
		await waitForValues(bob, MOSAIC_EVENTS.snapshot, 1)
		alice.clientEmit(MOSAIC_EVENTS.presence, {
			presence: { cursor: 3 },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: resource.key,
			session: `alice-session`,
		})
		const [online] = await waitForValues(bob, MOSAIC_EVENTS.presence, 1)
		expect(online).toMatchObject({ actor: `alice`, presence: { cursor: 3 } })

		await disconnectAlice()
		const presence = await waitForValues(bob, MOSAIC_EVENTS.presence, 2)
		expect(presence.at(-1)).toMatchObject({
			actor: `alice`,
			presence: null,
		})
		await disconnectBob()
		await server.dispose()
	})

	test(`recovers a consistent checkpoint and tail after restart`, async () => {
		const fixture = createRestartableServerFixture({
			createDurableState: () => new InMemoryMosaicStorage(),
			createEphemeralState: () => ({}),
			name: `mosaic-counter`,
			start: ({ durable }) =>
				createMosaicServer({ resources: [resource], storage: durable }),
			stop: (server) => server.dispose(),
		})
		let server = await fixture.start()
		const first = new TestSocket(`first`)
		const disconnectFirst = server.connect({
			actor: `alice`,
			session: `first-session`,
			socket: first,
		})
		join(first, `first-session`)
		await waitForValues(first, MOSAIC_EVENTS.snapshot, 1)
		propose(first, `first-session`, `alice:1`, { amount: 1, kind: `add` })
		propose(first, `first-session`, `alice:2`, { amount: 2, kind: `add` })
		await waitForValues(first, MOSAIC_EVENTS.operation, 2)
		await disconnectFirst()

		server = await fixture.restart({ durability: `preserve` })
		const second = new TestSocket(`second`)
		const disconnectSecond = server.connect({
			actor: `alice`,
			session: `second-session`,
			socket: second,
		})
		join(second, `second-session`, [`alice:1`, `alice:2`])
		const [snapshot] = (await waitForValues(
			second,
			MOSAIC_EVENTS.snapshot,
			1,
		)) as unknown as MosaicSnapshotEnvelope<CounterState>[]
		expect(snapshot?.revision).toBe(2)
		expect(snapshot?.acceptedPendingOperationIds).toEqual([`alice:1`, `alice:2`])
		expect(snapshot?.snapshot.entries).toHaveLength(2)
		expect(second.values(MOSAIC_EVENTS.presence)).toHaveLength(0)

		await disconnectSecond()
		await fixture.stop()
	})

	test(`shared-storage head hints converge two server projections`, async () => {
		const storage = new InMemoryMosaicStorage()
		const firstServer = createMosaicServer({ resources: [resource], storage })
		const secondServer = createMosaicServer({ resources: [resource], storage })
		const first = new TestSocket(`first`)
		const second = new TestSocket(`second`)
		const disconnectFirst = firstServer.connect({
			actor: `alice`,
			session: `first-session`,
			socket: first,
		})
		const disconnectSecond = secondServer.connect({
			actor: `bob`,
			session: `second-session`,
			socket: second,
		})
		join(first, `first-session`)
		join(second, `second-session`)
		await waitForValues(first, MOSAIC_EVENTS.snapshot, 1)
		await waitForValues(second, MOSAIC_EVENTS.snapshot, 1)
		propose(first, `first-session`, `alice:1`, { amount: 1, kind: `add` })
		propose(second, `second-session`, `bob:1`, { amount: 1, kind: `add` })
		await vi.waitFor(() => {
			expect(firstServer.resourceStatus(resource.key).revision).toBe(2)
			expect(secondServer.resourceStatus(resource.key).revision).toBe(2)
		})
		expect((await storage.recover(resource.key)).headRevision).toBe(2)

		await disconnectFirst()
		await disconnectSecond()
		await firstServer.dispose()
		await secondServer.dispose()
	})
})
