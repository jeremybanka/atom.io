import {
	assertMosaicDomainHistoryRequestResult,
	assertMosaicDomainHistorySnapshot,
	type MosaicDomainHistoryMode,
	type MosaicDomainHistoryRequest,
	type MosaicDomainHistoryRequestResult,
	type MosaicDomainHistorySnapshot,
} from "atom.io/realtime"

export type MosaicDomainHistoryClientTransport = {
	request(
		request: MosaicDomainHistoryRequest,
	): Promise<MosaicDomainHistoryRequestResult>
	snapshot(): Promise<MosaicDomainHistorySnapshot>
}

export type MosaicDomainHistoryClientProblem = {
	readonly reason: string
	readonly recovery: `domain-resnapshot` | `history-resnapshot` | `retry` | null
}

export type MosaicDomainHistoryClientState = {
	readonly pending: number
	readonly problem: MosaicDomainHistoryClientProblem | null
	readonly snapshot: MosaicDomainHistorySnapshot | null
	readonly status: `connecting` | `disposed` | `live` | `offline` | `rejected`
}

export type MosaicDomainHistoryClientOptions = {
	readonly actor: string
	readonly idSource?: (context: {
		readonly mode: MosaicDomainHistoryMode
		readonly sequence: number
		readonly session: string
	}) => string
	readonly maxPendingRequests?: number
	readonly onObserverError?: (error: unknown) => void
	readonly session: string
	readonly transport: MosaicDomainHistoryClientTransport
}

export type MosaicDomainHistoryClient = Disposable & {
	flush(): Promise<void>
	redo(): Promise<MosaicDomainHistoryRequestResult>
	refresh(): Promise<MosaicDomainHistorySnapshot>
	request(
		mode: MosaicDomainHistoryMode,
	): Promise<MosaicDomainHistoryRequestResult>
	readonly state: MosaicDomainHistoryClientState
	start(): Promise<void>
	subscribe(
		listener: (state: MosaicDomainHistoryClientState) => void,
	): () => void
	undo(): Promise<MosaicDomainHistoryRequestResult>
}

const identifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

/** Coordinate one authenticated actor/session cursor over MOS-16 history. */
export function createMosaicDomainHistoryClient(
	options: MosaicDomainHistoryClientOptions,
): MosaicDomainHistoryClient {
	if (!identifier(options.actor) || !identifier(options.session)) {
		throw new Error(`Domain history requires actor and session IDs.`)
	}
	const maxPendingRequests = options.maxPendingRequests ?? 16
	if (!Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 1) {
		throw new Error(`History client limits must be positive integers.`)
	}
	const listeners = new Set<(state: MosaicDomainHistoryClientState) => void>()
	let current: MosaicDomainHistorySnapshot | null = null
	let disposed = false
	let pending = 0
	let problem: MosaicDomainHistoryClientProblem | null = null
	let sequence = 0
	let started = false
	let status: MosaicDomainHistoryClientState[`status`] = `connecting`
	let queue = Promise.resolve()
	const idSource =
		options.idSource ??
		(({ mode, sequence: next, session }) =>
			`${session}:history:${mode}:${next.toString()}`)

	const state = (): MosaicDomainHistoryClientState =>
		Object.freeze({
			pending,
			problem,
			snapshot: current === null ? null : structuredClone(current),
			status,
		})
	const notify = (): void => {
		const next = state()
		for (const listener of listeners) {
			try {
				listener(next)
			} catch (error) {
				try {
					options.onObserverError?.(error)
				} catch {
					// Diagnostics must not change controller settlement.
				}
			}
		}
	}
	const enqueue = <Value>(work: () => Promise<Value>): Promise<Value> => {
		const result = queue.then(work, work)
		queue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
	const acceptSnapshot = (
		received: MosaicDomainHistorySnapshot,
	): MosaicDomainHistorySnapshot => {
		assertMosaicDomainHistorySnapshot(received, {
			actor: options.actor,
			minimumRevision: current?.cursor.revision ?? 0,
		})
		if (received.sessionSequence < sequence) {
			throw new Error(`Domain history returned a stale session sequence.`)
		}
		current = structuredClone(received)
		sequence = received.sessionSequence
		problem = null
		status = `live`
		notify()
		return structuredClone(received)
	}
	const refresh = async (): Promise<MosaicDomainHistorySnapshot> => {
		if (disposed) throw new Error(`This Domain history client is disposed.`)
		try {
			const received = await options.transport.snapshot()
			if (disposed) throw new Error(`This Domain history client is disposed.`)
			return acceptSnapshot(received)
		} catch (error) {
			if (!disposed) {
				status = `offline`
				problem = {
					reason: error instanceof Error ? error.message : String(error),
					recovery: `history-resnapshot`,
				}
				notify()
			}
			throw error
		}
	}

	const controller: MosaicDomainHistoryClient = {
		async flush() {
			await queue
		},
		redo: () => controller.request(`redo`),
		refresh: () => enqueue(refresh),
		request(mode) {
			if (disposed)
				return Promise.reject(
					new Error(`This Domain history client is disposed.`),
				)
			if (pending >= maxPendingRequests) {
				return Promise.reject(new Error(`Domain history client queue is full.`))
			}
			pending++
			notify()
			return enqueue(async () => {
				try {
					if (!started) await controller.start()
					if (current === null)
						throw new Error(`Domain history has no snapshot.`)
					const nextSequence = sequence + 1
					const id = idSource({
						mode,
						sequence: nextSequence,
						session: options.session,
					})
					if (!identifier(id))
						throw new Error(`History request IDs are invalid.`)
					let result: MosaicDomainHistoryRequestResult
					let retries = 0
					for (;;) {
						result = await options.transport.request({
							cursor: structuredClone(current.cursor),
							id,
							mode,
							sequence: nextSequence,
							session: options.session,
						})
						if (disposed) {
							throw new Error(`This Domain history client is disposed.`)
						}
						assertMosaicDomainHistoryRequestResult(result, {
							actor: options.actor,
							minimumRevision: current.cursor.revision,
						})
						current = structuredClone(result.snapshot)
						const expectedSequence =
							result.status === `accepted` ? nextSequence : sequence
						if (result.snapshot.sessionSequence !== expectedSequence) {
							throw new Error(
								`Domain history returned an invalid session sequence.`,
							)
						}
						if (
							result.status !== `rejected` ||
							result.recovery === `domain-resnapshot` ||
							retries++ >= 1
						) {
							break
						}
					}
					sequence = result.snapshot.sessionSequence
					if (result.status === `rejected`) {
						problem = { reason: result.reason, recovery: result.recovery }
						status = `rejected`
					} else {
						problem = null
						status = `live`
					}
					notify()
					return structuredClone(result)
				} catch (error) {
					if (!disposed) {
						status = `offline`
						problem = {
							reason: error instanceof Error ? error.message : String(error),
							recovery: `history-resnapshot`,
						}
						notify()
					}
					throw error
				} finally {
					pending--
					notify()
				}
			})
		},
		get state() {
			return state()
		},
		async start() {
			if (disposed) throw new Error(`This Domain history client is disposed.`)
			if (started) {
				if (current === null) await refresh()
				return
			}
			started = true
			try {
				await refresh()
			} catch (error) {
				started = false
				throw error
			}
		},
		subscribe(listener) {
			listeners.add(listener)
			try {
				listener(state())
			} catch (error) {
				try {
					options.onObserverError?.(error)
				} catch {
					// Diagnostics must not change subscription setup.
				}
			}
			return () => listeners.delete(listener)
		},
		undo: () => controller.request(`undo`),
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			status = `disposed`
			listeners.clear()
		},
	}
	return controller
}
