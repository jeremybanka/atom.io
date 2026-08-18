import {
	MOSAIC_DOMAIN_HISTORY_EVENTS,
	type MosaicDomainHistoryRequest,
	type MosaicDomainHistoryRequestResult,
	type MosaicDomainHistorySnapshot,
} from "atom.io/realtime"
import {
	createMosaicDomainHistoryClient,
	createMosaicDomainHistorySocketTransport,
} from "atom.io/realtime-client"
import {
	bindMosaicDomainHistoryServerSocket,
	type MosaicDomainHistoryConnection,
} from "atom.io/realtime-server"
import { vi } from "vitest"

const snapshot = (options: {
	actor?: string
	canRedo?: boolean
	canUndo?: boolean
	redoGestureId?: string | null
	redoSteps?: number
	revision: number
	sequence: number
	undoGestureId?: string | null
	undoSteps?: number
}): MosaicDomainHistorySnapshot => ({
	actor: options.actor ?? `ada`,
	cursor: {
		redoGestureId: options.redoGestureId ?? null,
		revision: options.revision,
		undoGestureId: options.undoGestureId ?? `gesture`,
	},
	horizon: {
		canRedo: options.canRedo ?? false,
		canUndo: options.canUndo ?? true,
		oldestRetainedRevision: 0,
		redoSteps: options.redoSteps ?? 0,
		truncatedBeforeRevision: 0,
		undoSteps: options.undoSteps ?? 1,
	},
	sessionSequence: options.sequence,
})

function fakeSocket() {
	const listeners = new Map<string, Set<(payload: any) => void>>()
	const emitted: Array<{ readonly event: string; readonly payload: any }> = []
	return {
		dispatch(event: string, payload?: any) {
			for (const listener of listeners.get(event) ?? []) listener(payload)
		},
		emitted,
		listeners,
		socket: {
			emit(event: string, payload: any) {
				emitted.push({ event, payload })
			},
			off(event: string, listener?: (payload: any) => void) {
				if (listener === undefined) listeners.delete(event)
				else listeners.get(event)?.delete(listener)
			},
			on(event: string, listener: (payload: any) => void) {
				const eventListeners = listeners.get(event) ?? new Set()
				eventListeners.add(listener)
				listeners.set(event, eventListeners)
			},
		},
	}
}

describe(`Mosaic Domain history client`, () => {
	test(`retries one recoverable rejection with the same identity and cursor sequence`, async () => {
		const initial = snapshot({ revision: 4, sequence: 7 })
		const recovered = snapshot({ revision: 5, sequence: 7 })
		const accepted = snapshot({ revision: 6, sequence: 8 })
		const requests: MosaicDomainHistoryRequest[] = []
		const observerErrors: unknown[] = []
		let attempt = 0
		const client = createMosaicDomainHistoryClient({
			actor: `ada`,
			onObserverError: (error) => observerErrors.push(error),
			session: `tab`,
			transport: {
				request(request) {
					requests.push(structuredClone(request))
					if (attempt++ === 0) {
						return Promise.resolve({
							reason: `stale cursor`,
							recovery: `history-resnapshot`,
							snapshot: recovered,
							status: `rejected`,
						})
					}
					return Promise.resolve({
						acceptedRevision: 6,
						snapshot: accepted,
						status: `accepted`,
					})
				},
				snapshot: () => Promise.resolve(initial),
			},
		})
		const unsubscribe = client.subscribe(() => {
			throw new Error(`observer failure`)
		})
		await expect(client.undo()).resolves.toMatchObject({ status: `accepted` })
		expect(requests).toHaveLength(2)
		expect(requests.map(({ cursor }) => cursor.revision)).toEqual([4, 5])
		expect(new Set(requests.map(({ id }) => id)).size).toBe(1)
		expect(requests.map(({ sequence }) => sequence)).toEqual([8, 8])
		expect(client.state).toMatchObject({ pending: 0, status: `live` })
		expect(client.state.snapshot).not.toBe(accepted)
		expect(observerErrors.length).toBeGreaterThan(0)
		unsubscribe()
		await client.flush()
		client[Symbol.dispose]()
		client[Symbol.dispose]()
		expect(client.state.status).toBe(`disposed`)
		await expect(client.redo()).rejects.toThrow(`disposed`)
		await expect(client.refresh()).rejects.toThrow(`disposed`)
		await expect(client.start()).rejects.toThrow(`disposed`)
	})

	test(`fails closed on transport projections and bounds pending work`, async () => {
		let releaseSnapshot!: (value: MosaicDomainHistorySnapshot) => void
		const blockedSnapshot = new Promise<MosaicDomainHistorySnapshot>(
			(resolve) => {
				releaseSnapshot = resolve
			},
		)
		const client = createMosaicDomainHistoryClient({
			actor: `ada`,
			idSource: () => ``,
			maxPendingRequests: 1,
			session: `tab`,
			transport: {
				request: () =>
					Promise.resolve({
						snapshot: snapshot({ revision: 1, sequence: 0 }),
						status: `unavailable`,
					}),
				snapshot: () => blockedSnapshot,
			},
		})
		const pending = client.undo()
		await expect(client.redo()).rejects.toThrow(`queue is full`)
		releaseSnapshot(snapshot({ revision: 1, sequence: 0 }))
		await expect(pending).rejects.toThrow(`request IDs are invalid`)
		expect(client.state.status).toBe(`offline`)

		for (const options of [
			{ actor: ``, session: `tab` },
			{ actor: `ada`, session: `` },
		]) {
			expect(() =>
				createMosaicDomainHistoryClient({
					...options,
					transport: { request: vi.fn(), snapshot: vi.fn() },
				}),
			).toThrow(`actor and session`)
		}
		expect(() =>
			createMosaicDomainHistoryClient({
				actor: `ada`,
				maxPendingRequests: 0,
				session: `tab`,
				transport: { request: vi.fn(), snapshot: vi.fn() },
			}),
		).toThrow(`positive integers`)
	})

	test(`does not consume a sequence for unavailable or rejected requests`, async () => {
		const requests: MosaicDomainHistoryRequest[] = []
		const results: MosaicDomainHistoryRequestResult[] = [
			{
				snapshot: snapshot({ revision: 2, sequence: 3 }),
				status: `unavailable`,
			},
			{
				reason: `checkpoint reset required`,
				recovery: `domain-resnapshot`,
				snapshot: snapshot({ revision: 3, sequence: 3 }),
				status: `rejected`,
			},
		]
		const client = createMosaicDomainHistoryClient({
			actor: `ada`,
			session: `tab`,
			transport: {
				request(request) {
					requests.push(request)
					return Promise.resolve(results.shift()!)
				},
				snapshot: () => Promise.resolve(snapshot({ revision: 1, sequence: 3 })),
			},
		})
		await expect(client.undo()).resolves.toMatchObject({ status: `unavailable` })
		await expect(client.redo()).resolves.toMatchObject({ status: `rejected` })
		expect(requests.map(({ sequence }) => sequence)).toEqual([4, 4])
		expect(client.state).toMatchObject({
			problem: { recovery: `domain-resnapshot` },
			status: `rejected`,
		})
	})

	test(`keeps monotonic state when refresh or disposal races transport work`, async () => {
		let snapshots = 0
		const stale = createMosaicDomainHistoryClient({
			actor: `ada`,
			onObserverError: () => {
				throw new Error(`diagnostics failed`)
			},
			session: `tab`,
			transport: {
				request: vi.fn(),
				snapshot: () =>
					Promise.resolve(
						snapshot({
							revision: ++snapshots,
							sequence: snapshots === 1 ? 2 : 1,
						}),
					),
			},
		})
		stale.subscribe(() => {
			throw new Error(`observer failed`)
		})
		await stale.start()
		await stale.start()
		await expect(stale.refresh()).rejects.toThrow(`stale session sequence`)
		expect(stale.state).toMatchObject({
			problem: { recovery: `history-resnapshot` },
			status: `offline`,
		})

		let settleRequest!: (result: MosaicDomainHistoryRequestResult) => void
		const inFlight = new Promise<MosaicDomainHistoryRequestResult>((resolve) => {
			settleRequest = resolve
		})
		const disposed = createMosaicDomainHistoryClient({
			actor: `ada`,
			session: `tab`,
			transport: {
				request: () => inFlight,
				snapshot: () => Promise.resolve(snapshot({ revision: 1, sequence: 0 })),
			},
		})
		await disposed.start()
		const request = disposed.undo()
		await vi.waitFor(() => {
			expect(disposed.state.pending).toBe(1)
		})
		disposed[Symbol.dispose]()
		settleRequest({
			acceptedRevision: 2,
			snapshot: snapshot({ revision: 2, sequence: 1 }),
			status: `accepted`,
		})
		await expect(request).rejects.toThrow(`disposed`)
		await disposed.flush()
		expect(disposed.state).toMatchObject({ pending: 0, status: `disposed` })
	})
})

describe(`Mosaic Domain history socket transport`, () => {
	test(`settles typed request and snapshot acknowledgements`, async () => {
		const wire = fakeSocket()
		let id = 0
		const transport = createMosaicDomainHistorySocketTransport(wire.socket, {
			idSource: () => `wire-${++id}`,
		})
		const request = transport.request({
			cursor: snapshot({ revision: 1, sequence: 0 }).cursor,
			id: `history-1`,
			mode: `undo`,
			sequence: 1,
			session: `payload-session-is-not-sent`,
		})
		expect(wire.emitted[0]).toMatchObject({
			event: MOSAIC_DOMAIN_HISTORY_EVENTS.request,
			payload: { command: { id: `history-1` }, requestId: `wire-1` },
		})
		expect(wire.emitted[0]?.payload.command).not.toHaveProperty(`session`)
		const accepted = {
			acceptedRevision: 2,
			snapshot: snapshot({ revision: 2, sequence: 1 }),
			status: `accepted`,
		} as const
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.response, {
			ok: true,
			requestId: `wire-1`,
			value: accepted,
		})
		await expect(request).resolves.toEqual(accepted)

		const nextSnapshot = transport.snapshot()
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.snapshotResponse, {
			ok: true,
			requestId: `wire-2`,
			value: snapshot({ revision: 2, sequence: 1 }),
		})
		await expect(nextSnapshot).resolves.toMatchObject({ sessionSequence: 1 })

		const rejected = transport.snapshot()
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.snapshotResponse, {
			error: { code: `internal`, reason: `offline`, retryable: true },
			ok: false,
			requestId: `wire-3`,
		})
		await expect(rejected).rejects.toThrow(`offline`)
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.response, {
			ok: true,
			requestId: `unknown`,
			value: accepted,
		})
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.response, null)
		transport[Symbol.dispose]()
		transport[Symbol.dispose]()
		await expect(transport.snapshot()).rejects.toThrow(`disposed`)
		expect(wire.listeners.get(`disconnect`)?.size ?? 0).toBe(0)
	})

	test(`bounds, times out, disconnects, and rejects duplicate wire IDs`, async () => {
		vi.useFakeTimers()
		try {
			const wire = fakeSocket()
			const transport = createMosaicDomainHistorySocketTransport(wire.socket, {
				idSource: () => `same`,
				maxPendingRequests: 1,
				requestTimeoutMs: 10,
			})
			const first = transport.snapshot()
			const disconnected = expect(first).rejects.toThrow(`disconnected`)
			await expect(transport.snapshot()).rejects.toThrow(`queue is full`)
			wire.dispatch(`disconnect`)
			await disconnected

			const timed = transport.snapshot()
			const timeout = expect(timed).rejects.toThrow(`timed out`)
			await vi.advanceTimersByTimeAsync(10)
			await timeout
			transport[Symbol.dispose]()
			for (const invalid of [
				{ maxPendingRequests: 0 },
				{ requestTimeoutMs: 0 },
			]) {
				expect(() =>
					createMosaicDomainHistorySocketTransport(fakeSocket().socket, invalid),
				).toThrow(`positive integers`)
			}
		} finally {
			vi.useRealTimers()
		}
	})
})

describe(`Mosaic Domain history server socket`, () => {
	test(`binds the authenticated session and reports invalid/internal work`, async () => {
		const wire = fakeSocket()
		const requests: MosaicDomainHistoryRequest[] = []
		const tracked: string[] = []
		let disposed = false
		const connection: MosaicDomainHistoryConnection = {
			request(request) {
				requests.push(request)
				if (request.id === `explode`) return Promise.reject(new Error(`denied`))
				return Promise.resolve({
					acceptedRevision: 2,
					snapshot: snapshot({ revision: 2, sequence: request.sequence }),
					status: `accepted`,
				})
			},
			snapshot: () => Promise.resolve(snapshot({ revision: 1, sequence: 0 })),
			[Symbol.dispose]() {
				disposed = true
			},
		}
		const cleanup = bindMosaicDomainHistoryServerSocket(
			connection,
			wire.socket,
			{
				session: `authenticated-tab`,
				work: {
					track(work, label) {
						tracked.push(label ?? ``)
						return Promise.resolve(work)
					},
				},
			},
		)
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.request, {
			command: {
				cursor: snapshot({ revision: 1, sequence: 0 }).cursor,
				id: `undo-1`,
				mode: `undo`,
				sequence: 1,
				session: `forged`,
			},
			requestId: `request-1`,
		})
		await vi.waitFor(() => {
			expect(wire.emitted).toHaveLength(1)
		})
		expect(requests[0]?.session).toBe(`authenticated-tab`)
		expect(wire.emitted[0]).toMatchObject({
			event: MOSAIC_DOMAIN_HISTORY_EVENTS.response,
			payload: { ok: true, requestId: `request-1` },
		})

		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.request, {
			command: { cursor: {}, id: `bad`, mode: `erase`, sequence: 0 },
			requestId: `request-2`,
		})
		expect(wire.emitted.at(-1)).toMatchObject({
			payload: {
				error: { code: `invalid-request`, retryable: false },
				ok: false,
			},
		})
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.request, {
			command: {
				cursor: snapshot({ revision: 1, sequence: 0 }).cursor,
				id: `explode`,
				mode: `undo`,
				sequence: 2,
			},
			requestId: `request-3`,
		})
		await vi.waitFor(() => {
			expect(wire.emitted).toHaveLength(3)
		})
		expect(wire.emitted.at(-1)).toMatchObject({
			payload: {
				error: { code: `internal`, reason: `denied`, retryable: true },
				ok: false,
			},
		})

		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.snapshot, {
			requestId: `snapshot-1`,
		})
		await vi.waitFor(() => {
			expect(wire.emitted).toHaveLength(4)
		})
		expect(wire.emitted.at(-1)?.event).toBe(
			MOSAIC_DOMAIN_HISTORY_EVENTS.snapshotResponse,
		)
		expect(tracked).toHaveLength(3)
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.request, () => undefined)
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.request, null)
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.snapshot, () => undefined)
		wire.dispatch(MOSAIC_DOMAIN_HISTORY_EVENTS.snapshot, null)
		wire.dispatch(`disconnect`)
		expect(disposed).toBe(true)
		cleanup()
		expect(wire.listeners.get(`disconnect`)?.size ?? 0).toBe(0)

		expect(() =>
			bindMosaicDomainHistoryServerSocket(connection, fakeSocket().socket, {
				session: ``,
			}),
		).toThrow(`authenticated session`)
	})
})
