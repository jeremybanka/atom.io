import type {
	Clock,
	RigidLease,
	RigidProblem,
	RigidSnapshot,
	RigidState,
	RigidWriteResult,
	Socket,
	StandardSchemaV1,
} from "@atom.io/realtime"
import {
	employSocket,
	encodeRealtimePayload,
	isRigidRecord,
	isRigidRevision,
	rigidEvents,
	systemClock,
} from "@atom.io/realtime"
import type { WritableToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import { setIntoStore, type Store } from "atom.io/internal"

export type RigidStateClient<Value extends Json.Serializable> = {
	readonly state: RigidState<Value>
	subscribe(listener: (state: RigidState<Value>) => void): () => void
	claim(): void
	release(): void
	/** Applies only after server acceptance. No offline speculative writes. */
	write(value: Value): Promise<RigidWriteResult<Value>>
	dispose(): void
}
export type RigidStateClientOptions<Value extends Json.Serializable> = {
	readonly store: Store
	readonly token: WritableToken<Value>
	readonly socket: Socket
	readonly schema: StandardSchemaV1<unknown, Value>
	readonly resource?: string
	readonly clock?: Clock
	readonly timeoutMs?: number
	readonly writable?: boolean
	readonly maxPendingWrites?: number
	readonly maxMessageBytes?: number
}

/** One controller may be shared by headless consumers and React observers. */
export function createRigidStateClient<Value extends Json.Serializable>(
	options: RigidStateClientOptions<Value>,
): RigidStateClient<Value> {
	const clock = options.clock ?? systemClock
	const timeout = options.timeoutMs ?? 10_000
	const maxPending = options.maxPendingWrites ?? 64
	const maxBytes = options.maxMessageBytes ?? 1_048_576
	for (const value of [timeout, maxPending, maxBytes])
		if (!Number.isSafeInteger(value) || value < 1)
			throw new Error(`Rigid limits must be positive safe integers`)
	const events = rigidEvents(options.resource ?? options.token.key)
	let state: RigidState<Value> = {
		status: `disconnected`,
		snapshot: null,
		lease: null,
		problem: null,
		pending: 0,
	}
	const listeners = new Set<(state: RigidState<Value>) => void>()
	const pending = new Map<
		string,
		{ timer: number; resolve: (result: RigidWriteResult<Value>) => void }
	>()
	let subscription = ``
	let disposed = false
	let connected = false
	let wantsWrite = options.writable ?? false
	let sequence = 0
	let delivery = 0
	let renewTimer: number | null = null
	let hydrateTimer: number | null = null
	let tail = Promise.resolve()
	let responsePending = 0
	const update = (next: Partial<RigidState<Value>>): void => {
		state = Object.freeze({ ...state, ...next, pending: pending.size })
		for (const listener of listeners) {
			try {
				listener(state)
			} catch (error) {
				options.store.logger.error(
					`📡`,
					`socket`,
					options.resource ?? options.token.key,
					`State listener failed`,
					error,
				)
			}
		}
	}
	const send = (message: Record<string, Json.Serializable>): void => {
		if (disposed || !connected) return
		try {
			options.socket.emit(events.request, {
				protocol: 1,
				subscription,
				...message,
			})
		} catch {
			connected = false
			cancelRenew()
			interrupt()
			update({
				status: `failed`,
				lease: null,
				problem: {
					code: `unavailable`,
					reason: `The transport could not send the request.`,
				},
			})
		}
	}
	const cancelRenew = (): void => {
		if (renewTimer !== null) clock.cancel(renewTimer)
		renewTimer = null
	}
	const interrupt = (): void => {
		for (const request of pending.values()) {
			clock.cancel(request.timer)
			request.resolve({ status: `interrupted`, outcome: `unknown` })
		}
		pending.clear()
	}
	const fail = (): void => {
		send({ kind: `unsubscribe` })
		connected = false
		if (hydrateTimer !== null) clock.cancel(hydrateTimer)
		hydrateTimer = null
		cancelRenew()
		interrupt()
		update({
			status: `failed`,
			lease: null,
			problem: {
				code: `invalid`,
				reason: `The server response could not be validated.`,
			},
		})
	}
	const scheduleRenew = (lease: RigidLease): void => {
		cancelRenew()
		renewTimer = clock.schedule(
			() => {
				renewTimer = null
				if (
					state.lease?.generation !== lease.generation ||
					state.lease.expiresAt !== lease.expiresAt ||
					disposed
				)
					return
				send({ kind: `renew`, generation: lease.generation })
				// Fail closed if the renewal reply is lost. Server time is deliberately
				// not compared with a client wall clock: bound authority by reply age.
				renewTimer = clock.schedule(
					() => {
						renewTimer = null
						if (
							state.lease?.generation === lease.generation &&
							state.lease.expiresAt === lease.expiresAt
						) {
							interrupt()
							update({
								status: `readonly`,
								lease: null,
								problem: {
									code: `lease-lost`,
									reason: `The lease renewal was not confirmed.`,
								},
							})
						}
					},
					lease.renewAfterMs,
					`rigid:renew-timeout`,
				)
			},
			lease.renewAfterMs,
			`rigid:renew`,
		)
	}
	const settle = (requestId: string, result: RigidWriteResult<Value>): void => {
		const request = pending.get(requestId)
		if (!request) return
		clock.cancel(request.timer)
		pending.delete(requestId)
		request.resolve(result)
		update(result.status === `rejected` ? { problem: result.problem } : {})
	}
	const readSnapshot = async (
		value: unknown,
	): Promise<RigidSnapshot<Value> | null> => {
		if (
			!isRigidRecord(value) ||
			typeof value[`epoch`] !== `string` ||
			!value[`epoch`] ||
			!isRigidRevision(value[`revision`])
		)
			return null
		const parsed = await options.schema[`~standard`].validate(value[`value`])
		if (parsed.issues) return null
		return {
			epoch: value[`epoch`],
			revision: value[`revision`],
			value: parsed.value,
		}
	}
	const stopResponse = employSocket(
		options.socket,
		events.response,
		(rawInput: unknown) => {
			const encoded = encodeRealtimePayload(rawInput, maxBytes)
			if (encoded === null) {
				fail()
				return
			}
			const input: unknown = JSON.parse(encoded)
			if (
				!connected ||
				disposed ||
				!isRigidRecord(input) ||
				state.status === `revoked` ||
				input[`protocol`] !== 1 ||
				input[`subscription`] !== subscription ||
				!isRigidRevision(input[`delivery`]) ||
				(input[`kind`] !== `result` && input[`delivery`] <= delivery)
			)
				return
			try {
				if (
					new TextEncoder().encode(JSON.stringify(input)).byteLength > maxBytes
				) {
					fail()
					return
				}
			} catch {
				fail()
				return
			}
			if (
				input[`kind`] === `result` &&
				(typeof input[`requestId`] !== `string` ||
					!pending.has(input[`requestId`]))
			)
				return
			if (responsePending >= maxPending * 2) {
				fail()
				return
			}
			responsePending++
			const currentSubscription = subscription
			const receivedDelivery = input[`delivery`]
			tail = tail
				.then(async () => {
					if (
						disposed ||
						!connected ||
						subscription !== currentSubscription ||
						(input[`kind`] !== `result` && receivedDelivery <= delivery)
					)
						return
					if (input[`kind`] === `revoked`) {
						delivery = receivedDelivery
						cancelRenew()
						interrupt()
						update({
							status: `revoked`,
							lease: null,
							snapshot: null,
							problem: {
								code: `unauthorized`,
								reason: `Read permission was revoked.`,
							},
						})
						return
					}
					if (input[`kind`] === `result` && input[`status`] === `rejected`) {
						const problem = input[`problem`]
						if (
							typeof input[`requestId`] !== `string` ||
							!isRigidRecord(problem) ||
							![
								`conflict`,
								`invalid`,
								`unauthorized`,
								`lease-lost`,
								`unavailable`,
							].includes(String(problem[`code`])) ||
							typeof problem[`reason`] !== `string`
						) {
							fail()
							return
						}
						delivery = Math.max(delivery, receivedDelivery)
						settle(input[`requestId`], {
							status: `rejected`,
							problem: problem as RigidProblem,
						})
						return
					}
					if (
						input[`kind`] !== `state` &&
						!(
							input[`kind`] === `result` &&
							input[`status`] === `accepted` &&
							typeof input[`requestId`] === `string`
						)
					) {
						fail()
						return
					}
					const next = await readSnapshot(input[`snapshot`])
					if (disposed || !connected || subscription !== currentSubscription)
						return
					if (!next || (state.snapshot && next.epoch !== state.snapshot.epoch)) {
						fail()
						return
					}
					if (
						state.snapshot &&
						next.revision < state.snapshot.revision &&
						input[`kind`] !== `result`
					)
						return
					delivery = Math.max(delivery, receivedDelivery)
					if (hydrateTimer !== null) clock.cancel(hydrateTimer)
					hydrateTimer = null
					if (input[`kind`] === `result`) {
						if (!state.snapshot || next.revision > state.snapshot.revision)
							setIntoStore(options.store, options.token, next.value)
						if (!state.snapshot || next.revision >= state.snapshot.revision)
							update({ snapshot: next })
						settle(input[`requestId`] as string, {
							status: `accepted`,
							snapshot: next,
						})
						return
					}
					const status = input[`status`]
					if (
						status !== `readonly` &&
						status !== `waiting` &&
						status !== `writable`
					) {
						fail()
						return
					}
					let lease: RigidLease | null = null
					if (status === `writable`) {
						const candidate = input[`lease`]
						if (
							!isRigidRecord(candidate) ||
							!isRigidRevision(candidate[`generation`]) ||
							!isRigidRevision(candidate[`expiresAt`]) ||
							!isRigidRevision(candidate[`renewAfterMs`]) ||
							candidate[`renewAfterMs`] < 1
						) {
							fail()
							return
						}
						lease = candidate as RigidLease
						if (lease.generation !== state.lease?.generation) sequence = 0
						if (
							lease.generation !== state.lease?.generation ||
							lease.expiresAt !== state.lease.expiresAt
						)
							scheduleRenew(lease)
					} else cancelRenew()
					if (!state.snapshot || next.revision > state.snapshot.revision)
						setIntoStore(options.store, options.token, next.value)
					const firstSnapshot = state.status === `hydrating`
					update({ status, snapshot: next, lease })
					if (firstSnapshot && wantsWrite) send({ kind: `claim` })
				})
				.catch(() => {
					if (subscription === currentSubscription && !disposed) fail()
				})
				.finally(() => {
					responsePending--
				})
		},
	)
	const connect = (): void => {
		if (disposed) return
		connected = true
		cancelRenew()
		interrupt()
		delivery = 0
		sequence = 0
		subscription = crypto.randomUUID()
		update({ status: `hydrating`, lease: null, snapshot: null, problem: null })
		if (hydrateTimer !== null) clock.cancel(hydrateTimer)
		hydrateTimer = clock.schedule(
			() => {
				hydrateTimer = null
				update({
					status: `failed`,
					problem: {
						code: `unavailable`,
						reason: `The resource did not respond.`,
					},
				})
			},
			timeout,
			`rigid:hydrate-timeout`,
		)
		send({ kind: `subscribe` })
	}
	const disconnect = (): void => {
		connected = false
		cancelRenew()
		interrupt()
		if (hydrateTimer !== null) clock.cancel(hydrateTimer)
		hydrateTimer = null
		update({ status: `disconnected`, lease: null })
	}
	const stopConnect = employSocket(options.socket, `connect`, connect)
	const stopDisconnect = employSocket(options.socket, `disconnect`, disconnect)
	if (options.socket.id !== undefined) connect()
	return {
		get state() {
			return state
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		claim() {
			wantsWrite = true
			if (state.snapshot) send({ kind: `claim` })
		},
		release() {
			wantsWrite = false
			cancelRenew()
			send({ kind: `release` })
			update({ status: connected ? `readonly` : `disconnected`, lease: null })
		},
		write(value) {
			if (
				disposed ||
				state.status !== `writable` ||
				!state.lease ||
				!state.snapshot
			)
				return Promise.resolve({
					status: `rejected`,
					problem: {
						code: `lease-lost`,
						reason: `A live write lease is required.`,
					},
				})
			if (pending.size >= maxPending)
				return Promise.resolve({
					status: `rejected`,
					problem: { code: `unavailable`, reason: `Too many pending writes.` },
				})
			const requestId = crypto.randomUUID()
			const result = new Promise<RigidWriteResult<Value>>((resolve) => {
				const timer = clock.schedule(
					() => {
						pending.delete(requestId)
						resolve({ status: `interrupted`, outcome: `unknown` })
						update({})
					},
					timeout,
					`rigid:write-timeout`,
				)
				pending.set(requestId, { timer, resolve })
			})
			update({ problem: null })
			send({
				kind: `write`,
				requestId,
				sequence: ++sequence,
				generation: state.lease.generation,
				epoch: state.snapshot.epoch,
				revision: state.snapshot.revision,
				value,
			})
			return result
		},
		dispose() {
			if (disposed) return
			send({ kind: `unsubscribe` })
			disposed = true
			disconnect()
			stopResponse()
			stopConnect()
			stopDisconnect()
			listeners.clear()
		},
	}
}
