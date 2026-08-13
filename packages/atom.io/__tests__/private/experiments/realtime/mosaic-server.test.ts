import type { Json } from "atom.io/foundations/json"
import {
	defineMosaicModel,
	defineMosaicResource,
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicAcceptedOperationEnvelope,
	type MosaicReduceContext,
	type MosaicRejectionEnvelope,
	type MosaicSnapshotEnvelope,
	type Socket,
	type StandardSchemaV1,
} from "atom.io/realtime"
import {
	createMosaicServer,
	defineMosaicServerResource,
	fingerprintMosaicOperation,
	InMemoryMosaicStorage,
	type MosaicStorageAdapter,
	type MosaicStorageAppendRequest,
	type MosaicStorageRecovery,
} from "atom.io/realtime-server"
import { createRestartableServerFixture } from "atom.io/realtime-testing"

type Add = { readonly amount: number; readonly kind: `add` }
type History = {
	readonly kind: `history`
	readonly mode: `redo` | `undo`
	readonly targetOperationIds: readonly string[]
}
type CounterOperation = Add | History
type CounterEntry = MosaicReduceContext & {
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
		context: MosaicReduceContext,
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
	hydrate: (snapshot: unknown): CounterState => {
		if (
			typeof snapshot !== `object` ||
			snapshot === null ||
			!Array.isArray(Reflect.get(snapshot, `entries`))
		) {
			throw new Error(`Invalid counter snapshot.`)
		}
		return structuredClone(snapshot) as CounterState
	},
	key: `test-counter`,
	prepare: (_state: CounterState, intent: CounterOperation): CounterOperation =>
		intent,
	snapshot: (state: CounterState): CounterState => structuredClone(state),
	validate: (_state: CounterState, operation: unknown) =>
		typeof operation === `object` &&
		operation !== null &&
		(Reflect.get(operation, `kind`) === `add` ||
			Reflect.get(operation, `kind`) === `history`)
			? { operation: operation as CounterOperation, status: `accept` as const }
			: { reason: `Invalid counter operation.`, status: `reject` as const },
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

const proposal = (
	session: string,
	id: string,
	operation: Json.Serializable = { amount: 1, kind: `add` },
): Json.Object => ({
	dependencies: [],
	group: `typing`,
	id,
	model: { key: counterModel.key, version: counterModel.version },
	operation,
	protocolVersion: MOSAIC_PROTOCOL_VERSION,
	resource: resource.key,
	session,
})

const acceptedEnvelope = (
	id: string,
	revision: number,
	amount = 1,
): MosaicAcceptedOperationEnvelope<CounterOperation> => ({
	operation: {
		actor: `alice`,
		dependencies: [],
		group: `typing`,
		id,
		model: { key: counterModel.key, version: counterModel.version },
		operation: { amount, kind: `add` },
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		resource: resource.key,
		session: `alice-session`,
	},
	revision,
})

const wrapStorage = (
	overrides: Partial<MosaicStorageAdapter> = {},
): MosaicStorageAdapter => {
	const backing = new InMemoryMosaicStorage()
	return {
		append: (request) => backing.append(request),
		checkpoint: (request) => backing.checkpoint(request),
		clearSession: (resourceKey, session) => {
			backing.clearSession(resourceKey, session)
		},
		receipt: (resourceKey, operationId) =>
			backing.receipt(resourceKey, operationId),
		recover: (resourceKey) => backing.recover(resourceKey),
		setSessionWatermark: (resourceKey, session, revision) => {
			backing.setSessionWatermark(resourceKey, session, revision)
		},
		watchHead: (resourceKey, listener) =>
			backing.watchHead(resourceKey, listener),
		...overrides,
	}
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

describe(`in-memory Mosaic storage`, () => {
	test(`atomically orders appends and retains immutable idempotency receipts`, async () => {
		const storage = new InMemoryMosaicStorage()
		const first = acceptedEnvelope(`alice:1`, 1)
		expect(
			fingerprintMosaicOperation({
				...first.operation,
				operation: { kind: `add`, amount: 1 },
			}),
		).toBe(fingerprintMosaicOperation(first.operation))
		expect(
			fingerprintMosaicOperation({
				...first.operation,
				session: `different-session`,
			}),
		).not.toBe(fingerprintMosaicOperation(first.operation))
		const hint = vi.fn()
		const stopWatching = storage.watchHead(resource.key, hint)

		expect(
			storage.append({
				accepted: first,
				expectedRevision: 0,
				fingerprint: `one`,
			}),
		).toMatchObject({ status: `accepted` })
		const mutableOperation = first.operation.operation as { amount: number }
		mutableOperation.amount = 999
		await vi.waitFor(() => {
			expect(hint).toHaveBeenCalledWith({ resource: resource.key, revision: 1 })
		})
		expect(
			storage.append({
				accepted: acceptedEnvelope(`alice:1`, 2),
				expectedRevision: 1,
				fingerprint: `one`,
			}),
		).toMatchObject({ accepted: { revision: 1 }, status: `duplicate` })
		expect(
			storage.append({
				accepted: acceptedEnvelope(`alice:1`, 2, 2),
				expectedRevision: 1,
				fingerprint: `different`,
			}),
		).toMatchObject({ status: `collision` })
		expect(
			storage.append({
				accepted: acceptedEnvelope(`alice:2`, 2),
				expectedRevision: 0,
				fingerprint: `two`,
			}),
		).toEqual({ actualRevision: 1, status: `stale` })
		expect(() =>
			storage.append({
				accepted: acceptedEnvelope(`alice:2`, 3),
				expectedRevision: 1,
				fingerprint: `two`,
			}),
		).toThrow(`must use revision 2`)
		expect(storage.receipt(resource.key, `missing`)).toBeNull()
		expect(storage.receipt(resource.key, `alice:1`)).toMatchObject({
			accepted: { operation: { operation: { amount: 1 } } },
		})

		stopWatching()
		storage.append({
			accepted: acceptedEnvelope(`alice:2`, 2),
			expectedRevision: 1,
			fingerprint: `two`,
		})
		await Promise.resolve()
		expect(hint).toHaveBeenCalledTimes(1)
	})

	test(`checkpoints with retention fencing, monotonic watermarks, and receipts`, () => {
		const storage = new InMemoryMosaicStorage()
		storage.append({
			accepted: acceptedEnvelope(`alice:1`, 1),
			expectedRevision: 0,
			fingerprint: `one`,
		})
		storage.append({
			accepted: acceptedEnvelope(`alice:2`, 2),
			expectedRevision: 1,
			fingerprint: `two`,
		})
		expect(() => {
			storage.setSessionWatermark(resource.key, `bad`, -1)
		}).toThrow(`non-negative integer`)
		storage.setSessionWatermark(resource.key, `slow`, 1)
		storage.setSessionWatermark(resource.key, `slow`, 0)
		const checkpoint = {
			model: { key: counterModel.key, version: counterModel.version },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: resource.key,
			revision: 2,
			snapshot: emptyState(),
		} as const
		expect(
			storage.checkpoint({
				checkpoint,
				expectedRetentionEpoch: 4,
				expectedRevision: 2,
			}),
		).toEqual({ actualRevision: 2, retentionEpoch: 0, status: `stale` })
		expect(
			storage.checkpoint({
				checkpoint,
				expectedRetentionEpoch: 0,
				expectedRevision: 2,
			}),
		).toEqual({ compactedThrough: 1, retentionEpoch: 1, status: `stored` })
		expect(storage.recover(resource.key)).toMatchObject({
			checkpoint: { revision: 2 },
			headRevision: 2,
			receiptIds: [`alice:1`, `alice:2`],
			retentionEpoch: 1,
			tail: [],
		})
		storage.clearSession(resource.key, `slow`)
	})
})

describe(`Mosaic server`, () => {
	test(`validates configuration and connection lifecycle`, async () => {
		expect(() =>
			createMosaicServer({ resources: [resource, resource] }),
		).toThrow(`Duplicate Mosaic resource key`)
		expect(() =>
			createMosaicServer({
				resources: [{ ...resource, checkpointEvery: 0 }],
			}),
		).toThrow(`checkpointEvery must be a positive safe integer`)

		const server = createMosaicServer({ resources: [resource] })
		expect(server.resourceStatus(resource.key)).toEqual({
			initialized: false,
			revision: 0,
		})
		expect(await server.checkpoint(`missing`)).toBe(false)
		expect(() =>
			server.connect({
				actor: ``,
				session: `session`,
				socket: new TestSocket(`x`),
			}),
		).toThrow(`require an actor and session`)
		const disconnect = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket: new TestSocket(`alice`),
		})
		await disconnect()
		await disconnect()
		const activeSocket = new TestSocket(`active`)
		server.connect({
			actor: `active`,
			session: `active-session`,
			socket: activeSocket,
		})
		await server.dispose()
		join(activeSocket, `active-session`)
		expect(activeSocket.emitted).toHaveLength(0)
		await server.dispose()
		expect(() =>
			server.connect({
				actor: `alice`,
				session: `late`,
				socket: new TestSocket(`late`),
			}),
		).toThrow(`disposed`)
	})

	test(`rejects malformed, unavailable, incompatible, and spoofed joins`, async () => {
		const server = createMosaicServer({ resources: [resource] })
		const socket = new TestSocket(`alice`)
		const disconnect = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket,
		})
		const requests: Json.Serializable[] = [
			{ protocolVersion: 99, resource: resource.key },
			null,
			{
				knownRevision: -1,
				model: { key: counterModel.key, version: counterModel.version },
				pendingOperationIds: [],
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: resource.key,
				session: `alice-session`,
			},
			{
				knownRevision: null,
				model: { key: counterModel.key, version: counterModel.version },
				pendingOperationIds: [],
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: `missing`,
				session: `alice-session`,
			},
			{
				knownRevision: null,
				model: { key: counterModel.key, version: 99 },
				pendingOperationIds: [],
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: resource.key,
				session: `alice-session`,
			},
			{
				knownRevision: null,
				model: { key: counterModel.key, version: counterModel.version },
				pendingOperationIds: [],
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: resource.key,
				session: `spoofed`,
			},
		]
		for (const request of requests)
			socket.clientEmit(MOSAIC_EVENTS.join, request)
		const rejections = (await waitForValues(
			socket,
			MOSAIC_EVENTS.rejection,
			requests.length,
		)) as unknown as MosaicRejectionEnvelope[]
		expect(rejections.map(({ code }) => code)).toEqual([
			`incompatible-version`,
			`invalid-payload`,
			`invalid-payload`,
			`resource-unavailable`,
			`incompatible-version`,
			`unauthorized`,
		])
		await disconnect()
		await server.dispose()
	})

	test(`checks read authorization before accessing persistence`, async () => {
		const recover = vi.fn(() => {
			throw new Error(`storage must remain private`)
		})
		const storage = wrapStorage({ recover })
		const server = createMosaicServer({
			authorize: ({ action }) => action !== `read`,
			resources: [resource],
			storage,
		})
		const socket = new TestSocket(`alice`)
		const disconnect = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket,
		})
		join(socket, `alice-session`)
		const [rejection] = (await waitForValues(
			socket,
			MOSAIC_EVENTS.rejection,
			1,
		)) as unknown as MosaicRejectionEnvelope[]
		expect(rejection?.code).toBe(`unauthorized`)
		expect(recover).not.toHaveBeenCalled()
		await disconnect()
		await server.dispose()
	})

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
		expect(collision?.session).toBe(`alice-session`)

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

	test(`rejects malformed, spoofed, unauthorized, and schema-invalid proposals`, async () => {
		let denyEdits = false
		const server = createMosaicServer({
			authorize: ({ action }) => !(action === `propose` && denyEdits),
			resources: [resource],
		})
		const socket = new TestSocket(`alice`)
		const disconnect = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket,
		})
		socket.clientEmit(MOSAIC_EVENTS.operation, {
			...proposal(`alice-session`, `bad-version`),
			protocolVersion: 99,
		})
		socket.clientEmit(MOSAIC_EVENTS.operation, null)
		socket.clientEmit(MOSAIC_EVENTS.operation, {
			...proposal(`alice-session`, `self-dependent`),
			dependencies: [`self-dependent`],
		})
		socket.clientEmit(
			MOSAIC_EVENTS.operation,
			proposal(`alice-session`, `before-join`),
		)
		join(socket, `alice-session`)
		await waitForValues(socket, MOSAIC_EVENTS.snapshot, 1)
		socket.clientEmit(MOSAIC_EVENTS.operation, {
			...proposal(`alice-session`, `bad-model`),
			model: { key: counterModel.key, version: 99 },
		})
		socket.clientEmit(
			MOSAIC_EVENTS.operation,
			proposal(`spoofed`, `spoofed-session`),
		)
		socket.clientEmit(
			MOSAIC_EVENTS.operation,
			proposal(`alice-session`, `bad-schema`, { kind: `unknown` }),
		)
		denyEdits = true
		socket.clientEmit(
			MOSAIC_EVENTS.operation,
			proposal(`alice-session`, `denied`),
		)
		const rejections = (await waitForValues(
			socket,
			MOSAIC_EVENTS.rejection,
			8,
		)) as unknown as MosaicRejectionEnvelope[]
		expect(rejections.map(({ code }) => code)).toEqual([
			`incompatible-version`,
			`invalid-payload`,
			`invalid-payload`,
			`incompatible-version`,
			`incompatible-version`,
			`unauthorized`,
			`invalid-model-operation`,
			`unauthorized`,
		])
		await disconnect()
		await server.dispose()
	})

	test(`surfaces model deferral and rejection decisions`, async () => {
		const decisionModel = defineMosaicModel({
			...counterModel,
			validate: (
				_state: CounterState,
				operation: unknown,
			): ReturnType<typeof counterModel.validate> => {
				if (
					typeof operation === `object` &&
					operation !== null &&
					Reflect.get(operation, `amount`) === 91
				) {
					return { dependencies: [`server-anchor`], status: `defer` }
				}
				if (
					typeof operation === `object` &&
					operation !== null &&
					Reflect.get(operation, `amount`) === 92
				) {
					return { reason: `model says no`, status: `reject` }
				}
				return counterModel.validate(emptyState(), operation, {
					actor: `alice`,
					dependencies: [],
					group: null,
					id: `validation`,
					revision: 1,
					session: `alice-session`,
				})
			},
		})
		const decisionResource = defineMosaicServerResource({
			...resource,
			model: decisionModel,
		})
		const server = createMosaicServer({ resources: [decisionResource] })
		const socket = new TestSocket(`alice`)
		const disconnect = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket,
		})
		join(socket, `alice-session`)
		await waitForValues(socket, MOSAIC_EVENTS.snapshot, 1)
		propose(socket, `alice-session`, `deferred`, { amount: 91, kind: `add` })
		propose(socket, `alice-session`, `rejected`, { amount: 92, kind: `add` })
		const rejections = (await waitForValues(
			socket,
			MOSAIC_EVENTS.rejection,
			2,
		)) as unknown as MosaicRejectionEnvelope[]
		expect(rejections).toMatchObject([
			{ code: `missing-dependency`, recovery: `retry` },
			{ code: `invalid-model-operation`, reason: `model says no` },
		])
		await disconnect()
		await server.dispose()
	})

	test(`handles every linearizable append outcome`, async () => {
		const outcomes = [
			{
				append: (request: MosaicStorageAppendRequest) => ({
					accepted: request.accepted,
					status: `duplicate` as const,
				}),
				code: null,
			},
			{
				append: (request: MosaicStorageAppendRequest) => ({
					existing: {
						accepted: request.accepted,
						fingerprint: `other`,
					},
					status: `collision` as const,
				}),
				code: `operation-id-collision`,
			},
			{
				append: () => ({ actualRevision: 0, status: `stale` as const }),
				code: `resource-unavailable`,
			},
		] as const

		for (const [index, outcome] of outcomes.entries()) {
			const storage = wrapStorage({
				append: outcome.append,
				receipt: () => null,
			})
			const server = createMosaicServer({ resources: [resource], storage })
			const socket = new TestSocket(`socket-${index}`)
			const disconnect = server.connect({
				actor: `alice`,
				session: `alice-session`,
				socket,
			})
			join(socket, `alice-session`)
			await waitForValues(socket, MOSAIC_EVENTS.snapshot, 1)
			propose(socket, `alice-session`, `operation-${index}`, {
				amount: 1,
				kind: `add`,
			})
			if (outcome.code === null) {
				await waitForValues(socket, MOSAIC_EVENTS.operation, 1)
			} else {
				const [rejection] = (await waitForValues(
					socket,
					MOSAIC_EVENTS.rejection,
					1,
				)) as unknown as MosaicRejectionEnvelope[]
				expect(rejection?.code).toBe(outcome.code)
			}
			await disconnect()
			await server.dispose()
		}
	})

	test(`fails closed on corrupted recovery and handler errors`, async () => {
		const emptyRecovery: MosaicStorageRecovery = {
			checkpoint: null,
			headRevision: 0,
			receiptIds: [],
			retentionEpoch: 0,
			tail: [],
		}
		const corruptions: MosaicStorageRecovery[] = [
			{
				...emptyRecovery,
				checkpoint: {
					model: { key: `wrong`, version: 1 },
					protocolVersion: MOSAIC_PROTOCOL_VERSION,
					resource: resource.key,
					revision: 0,
					snapshot: emptyState(),
				},
			},
			{
				...emptyRecovery,
				headRevision: 2,
				tail: [acceptedEnvelope(`alice:2`, 2)],
			},
			{ ...emptyRecovery, headRevision: 1 },
		]

		for (const [index, recovery] of corruptions.entries()) {
			const server = createMosaicServer({
				resources: [resource],
				storage: wrapStorage({ recover: () => recovery }),
			})
			const socket = new TestSocket(`corrupt-${index}`)
			const disconnect = server.connect({
				actor: `alice`,
				session: `alice-session`,
				socket,
			})
			join(socket, `alice-session`)
			const [rejection] = (await waitForValues(
				socket,
				MOSAIC_EVENTS.rejection,
				1,
			)) as unknown as MosaicRejectionEnvelope[]
			expect(rejection).toMatchObject({
				code: `resource-unavailable`,
				recovery: `retry`,
			})
			await disconnect()
			await server.dispose()
		}
	})

	test(`returns false when checkpoint fencing loses a race`, async () => {
		const checkpoint = vi.fn(() => ({
			actualRevision: 0,
			retentionEpoch: 0,
			status: `stale` as const,
		}))
		const server = createMosaicServer({
			resources: [resource],
			storage: wrapStorage({ checkpoint }),
		})
		expect(await server.checkpoint(resource.key)).toBe(false)
		expect(checkpoint).toHaveBeenCalledOnce()
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
		const charlie = new TestSocket(`charlie-socket`)
		const disconnectCharlie = server.connect({
			actor: `charlie`,
			session: `charlie-session`,
			socket: charlie,
		})
		join(charlie, `charlie-session`)
		await waitForValues(charlie, MOSAIC_EVENTS.snapshot, 1)
		const [existingPresence] = await waitForValues(
			charlie,
			MOSAIC_EVENTS.presence,
			1,
		)
		expect(existingPresence).toMatchObject({
			actor: `alice`,
			presence: { cursor: 3 },
		})

		alice.clientEmit(MOSAIC_EVENTS.presence, {
			presence: null,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: resource.key,
			session: `alice-session`,
		})
		const departed = await waitForValues(bob, MOSAIC_EVENTS.presence, 2)
		expect(departed.at(-1)).toMatchObject({
			actor: `alice`,
			presence: null,
		})

		alice.clientEmit(MOSAIC_EVENTS.presence, {
			presence: { cursor: 4 },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: resource.key,
			session: `alice-session`,
		})
		await waitForValues(bob, MOSAIC_EVENTS.presence, 3)
		await disconnectAlice()
		const presence = await waitForValues(bob, MOSAIC_EVENTS.presence, 4)
		expect(presence.at(-1)).toMatchObject({
			actor: `alice`,
			presence: null,
		})
		await disconnectBob()
		await disconnectCharlie()
		await server.dispose()
	})

	test(`validates, authorizes, and model-checks presence`, async () => {
		let allowPresence = false
		const guardedResource = defineMosaicServerResource({
			...resource,
			validatePresence: ({ cursor }: { readonly cursor: number }) => cursor < 10,
		})
		const server = createMosaicServer({
			authorize: ({ action }) => action !== `presence` || allowPresence,
			resources: [guardedResource],
		})
		const socket = new TestSocket(`alice`)
		const disconnect = server.connect({
			actor: `alice`,
			session: `alice-session`,
			socket,
		})
		join(socket, `alice-session`)
		await waitForValues(socket, MOSAIC_EVENTS.snapshot, 1)
		for (const presence of [
			`malformed`,
			{
				presence: { cursor: `invalid` },
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: resource.key,
				session: `alice-session`,
			},
			{
				presence: { cursor: 1 },
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: resource.key,
				session: `spoofed`,
			},
			{
				presence: { cursor: 1 },
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: resource.key,
				session: `alice-session`,
			},
			{
				presence: null,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: resource.key,
				session: `alice-session`,
			},
		] as const) {
			socket.clientEmit(MOSAIC_EVENTS.presence, presence)
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(socket.values(MOSAIC_EVENTS.presence)).toHaveLength(0)

		allowPresence = true
		socket.clientEmit(MOSAIC_EVENTS.presence, {
			presence: { cursor: 11 },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: resource.key,
			session: `alice-session`,
		})
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(socket.values(MOSAIC_EVENTS.presence)).toHaveLength(0)
		socket.clientEmit(MOSAIC_EVENTS.presence, {
			presence: null,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: resource.key,
			session: `alice-session`,
		})
		await disconnect()
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
		expect(snapshot?.session).toBe(`second-session`)
		expect(snapshot?.snapshot.entries).toHaveLength(2)
		expect(snapshot?.snapshot.entries.map(({ revision }) => revision)).toEqual([
			1, 2,
		])
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

	test(`treats head watches as hints and sends a checkpoint snapshot on a jump`, async () => {
		const backing = new InMemoryMosaicStorage()
		const watchers = new Set<
			(hint: { resource: string; revision: number }) => void
		>()
		const disposedWatches = vi.fn()
		const storage = wrapStorage({
			append: (request) => backing.append(request),
			checkpoint: (request) => backing.checkpoint(request),
			clearSession: (resourceKey, session) => {
				backing.clearSession(resourceKey, session)
			},
			receipt: (resourceKey, operationId) =>
				backing.receipt(resourceKey, operationId),
			recover: (resourceKey) => backing.recover(resourceKey),
			setSessionWatermark: (resourceKey, session, revision) => {
				backing.setSessionWatermark(resourceKey, session, revision)
			},
			watchHead: (_resourceKey, listener) => {
				watchers.add(listener)
				return () => {
					watchers.delete(listener)
					disposedWatches()
				}
			},
		})
		const ungroupedResource = defineMosaicServerResource({
			...defineMosaicResource({ key: resource.key, model: counterModel }),
			operationSchema,
			presenceSchema,
		})
		const writerServer = createMosaicServer({
			resources: [ungroupedResource],
			storage,
		})
		const readerServer = createMosaicServer({
			resources: [ungroupedResource],
			storage,
		})
		const writer = new TestSocket(`writer`)
		const reader = new TestSocket(`reader`)
		const disconnectWriter = writerServer.connect({
			actor: `alice`,
			session: `writer-session`,
			socket: writer,
		})
		const disconnectReader = readerServer.connect({
			actor: `bob`,
			session: `reader-session`,
			socket: reader,
		})
		join(writer, `writer-session`)
		join(reader, `reader-session`)
		await waitForValues(writer, MOSAIC_EVENTS.snapshot, 1)
		await waitForValues(reader, MOSAIC_EVENTS.snapshot, 1)
		propose(writer, `writer-session`, `alice:jump`, {
			amount: 1,
			kind: `add`,
		})
		await waitForValues(writer, MOSAIC_EVENTS.operation, 1)
		expect(await writerServer.checkpoint(resource.key)).toBe(true)
		for (const watcher of watchers) {
			watcher({ resource: resource.key, revision: 1 })
		}
		const snapshots = (await waitForValues(
			reader,
			MOSAIC_EVENTS.snapshot,
			2,
		)) as unknown as MosaicSnapshotEnvelope<CounterState>[]
		expect(snapshots.at(-1)).toMatchObject({
			revision: 1,
			session: `reader-session`,
		})

		await disconnectWriter()
		await disconnectReader()
		await writerServer.dispose()
		await readerServer.dispose()
		expect(disposedWatches).toHaveBeenCalledTimes(2)
		expect(watchers.size).toBe(0)
	})
})
