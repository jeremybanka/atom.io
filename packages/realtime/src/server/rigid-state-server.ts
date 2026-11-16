import type {
	Clock,
	RigidLease,
	RigidProblem,
	RigidSnapshot,
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
import {
	getFromStore,
	setIntoStore,
	type Store,
	subscribeToState,
} from "atom.io/internal"

export type RigidStateServerOptions<
	Value extends Json.Serializable,
	Identity,
> = {
	readonly store: Store
	readonly token: WritableToken<Value>
	readonly schema: StandardSchemaV1<unknown, Value>
	/** Authorize at subscription, delivery, claim, renewal and write acceptance. */
	readonly authorize: (identity: Identity, access: `read` | `write`) => boolean
	readonly resource?: string
	readonly clock?: Clock
	readonly leaseDurationMs?: number
	readonly maxMessageBytes?: number
	readonly maxPendingWrites?: number
	/** A new epoch is required after restart or replacement of the authority. */
	readonly epoch?: string
}
export type RigidStateServer<Identity> = {
	connect(socket: Socket, identity: Identity): () => void
	/** Invoke synchronously when a product permission changes. */
	revalidate(): void
	dispose(): void
}

const authorities = new WeakMap<Store, Set<string>>()

/** Own exactly one server controller for each authoritative resource. */
export function createRigidStateServer<
	Value extends Json.Serializable,
	Identity,
>(
	options: RigidStateServerOptions<Value, Identity>,
): RigidStateServer<Identity> {
	const clock = options.clock ?? systemClock
	const duration = options.leaseDurationMs ?? 10_000
	const maxBytes = options.maxMessageBytes ?? 1_048_576
	const maxPending = options.maxPendingWrites ?? 64
	for (const value of [duration, maxBytes, maxPending]) {
		if (!Number.isSafeInteger(value) || value < 1)
			throw new Error(`Rigid limits must be positive safe integers`)
	}
	const events = rigidEvents(options.resource ?? options.token.key)
	const epoch = options.epoch ?? crypto.randomUUID()
	if (!epoch) throw new Error(`Rigid epoch must not be empty`)
	type Connection = {
		socket: Socket
		identity: Identity
		subscription: string | null
		active: boolean
		delivery: number
		generation: number
		sequence: number
		lease: RigidLease | null
		pending: number
		dispose: () => void
	}
	const owned = authorities.get(options.store) ?? new Set<string>()
	if (owned.has(options.token.key))
		throw new Error(
			`A Rigid authority already exists for this token in this Store`,
		)
	authorities.set(options.store, owned)
	owned.add(options.token.key)
	const connections = new Set<Connection>()
	const waiting: Connection[] = []
	let owner: Connection | null = null
	let expiry: number | null = null
	let generation = 0
	let revision = 0
	let disposed = false
	let tail = Promise.resolve()
	const snapshot = (): RigidSnapshot<Value> => ({
		epoch,
		revision,
		value: getFromStore(options.store, options.token),
	})
	const permitted = (
		connection: Connection,
		access: `read` | `write`,
	): boolean => {
		try {
			return connection.active && options.authorize(connection.identity, access)
		} catch {
			return false
		}
	}
	const send = (connection: Connection, message: Json.Serializable): void => {
		if (connection.active && connection.subscription !== null) {
			try {
				connection.socket.emit(events.response, {
					protocol: 1,
					subscription: connection.subscription,
					delivery: ++connection.delivery,
					...(message as Record<string, Json.Serializable>),
				})
			} catch {
				connection.dispose()
			}
		}
	}
	const state = (connection: Connection): void => {
		send(connection, {
			kind: `state`,
			status:
				owner === connection
					? `writable`
					: waiting.includes(connection)
						? `waiting`
						: `readonly`,
			lease: connection.lease,
			snapshot: snapshot(),
		})
	}
	const removeWaiting = (connection: Connection): void => {
		const index = waiting.indexOf(connection)
		if (index >= 0) waiting.splice(index, 1)
	}
	const scheduleExpiry = (): void => {
		if (expiry !== null) clock.cancel(expiry)
		const current = owner
		if (!current?.lease) return
		expiry = clock.schedule(
			() => {
				expiry = null
				if (owner === current) release(current)
			},
			Math.max(0, current.lease.expiresAt - clock.now()),
			`rigid:lease`,
		)
	}
	const grant = (connection: Connection): void => {
		owner = connection
		connection.generation = ++generation
		connection.sequence = 0
		connection.lease = {
			generation,
			expiresAt: clock.now() + duration,
			renewAfterMs: Math.max(1, Math.floor(duration / 3)),
		}
		scheduleExpiry()
		state(connection)
	}
	const release = (connection: Connection): void => {
		removeWaiting(connection)
		if (owner !== connection) return
		owner = null
		connection.lease = null
		if (expiry !== null) clock.cancel(expiry)
		expiry = null
		if (permitted(connection, `read`)) state(connection)
		while (!owner && waiting.length > 0) {
			const next = waiting.shift()!
			if (
				next.subscription &&
				permitted(next, `read`) &&
				permitted(next, `write`)
			)
				grant(next)
		}
	}
	const revoke = (connection: Connection): void => {
		send(connection, { kind: `revoked` })
		connection.subscription = null
		release(connection)
	}
	const revalidate = (): void => {
		for (const connection of connections) {
			if (!connection.subscription) continue
			if (!permitted(connection, `read`)) revoke(connection)
			else if (!permitted(connection, `write`)) {
				release(connection)
				state(connection)
			}
		}
	}
	const stopState = subscribeToState(
		options.store,
		options.token,
		`rigid:${epoch}`,
		() => {
			revision++
			for (const connection of connections) {
				if (!connection.subscription) continue
				if (!permitted(connection, `read`)) revoke(connection)
				else state(connection)
			}
		},
	)
	return {
		revalidate,
		connect(socket, identity) {
			if (disposed) throw new Error(`Rigid server is disposed`)
			const connection: Connection = {
				socket,
				identity,
				subscription: null,
				active: true,
				delivery: 0,
				generation: 0,
				sequence: 0,
				lease: null,
				pending: 0,
				dispose: () => {},
			}
			connections.add(connection)
			const reject = (
				requestId: string,
				code: RigidProblem[`code`],
				reason: string,
			): void => {
				send(connection, {
					kind: `result`,
					requestId,
					status: `rejected`,
					problem: { code, reason },
				})
				if (permitted(connection, `read`)) state(connection)
			}
			const stopRequest = employSocket(
				socket,
				events.request,
				(rawInput: unknown) => {
					const encoded = encodeRealtimePayload(rawInput, maxBytes)
					if (encoded === null) return
					const input: unknown = JSON.parse(encoded)
					if (
						!isRigidRecord(input) ||
						input[`protocol`] !== 1 ||
						typeof input[`subscription`] !== `string` ||
						input[`subscription`].length > 256
					)
						return
					try {
						if (
							new TextEncoder().encode(JSON.stringify(input)).byteLength >
							maxBytes
						)
							return
					} catch {
						return
					}
					if (input[`kind`] === `subscribe`) {
						if (connection.subscription !== input[`subscription`])
							release(connection)
						connection.subscription = input[`subscription`]
						if (!permitted(connection, `read`)) revoke(connection)
						else state(connection)
						return
					}
					if (
						input[`subscription`] !== connection.subscription ||
						!connection.subscription
					)
						return
					if (!permitted(connection, `read`)) {
						revoke(connection)
						return
					}
					if (input[`kind`] === `unsubscribe`) {
						connection.subscription = null
						release(connection)
						return
					}
					if (input[`kind`] === `release`) {
						release(connection)
						state(connection)
						return
					}
					if (input[`kind`] === `claim`) {
						if (!permitted(connection, `write`)) {
							release(connection)
							state(connection)
							return
						}
						if (!owner) grant(connection)
						else if (owner === connection) state(connection)
						else {
							if (!waiting.includes(connection)) waiting.push(connection)
							state(connection)
						}
						return
					}
					if (input[`kind`] === `renew`) {
						if (
							owner === connection &&
							connection.lease &&
							connection.lease.expiresAt > clock.now() &&
							input[`generation`] === connection.generation &&
							permitted(connection, `write`)
						) {
							connection.lease = {
								...connection.lease,
								expiresAt: clock.now() + duration,
							}
							scheduleExpiry()
							state(connection)
						} else {
							release(connection)
							state(connection)
						}
						return
					}
					if (
						input[`kind`] !== `write` ||
						typeof input[`requestId`] !== `string` ||
						input[`requestId`].length > 256
					)
						return
					const requestId = input[`requestId`]
					const subscription = connection.subscription
					const fence = input[`generation`]
					const sequence = input[`sequence`]
					const current = (): boolean =>
						connection.active &&
						connection.subscription === subscription &&
						owner === connection &&
						connection.lease !== null &&
						fence === connection.generation &&
						connection.lease.expiresAt > clock.now()
					if (!current()) {
						reject(requestId, `lease-lost`, `A live write lease is required.`)
						return
					}
					if (
						!isRigidRevision(sequence) ||
						sequence !== connection.sequence + 1
					) {
						reject(
							requestId,
							`invalid`,
							`Publication sequence is not the next sequence.`,
						)
						return
					}
					connection.sequence = sequence
					if (connection.pending >= maxPending) {
						reject(requestId, `unavailable`, `Too many pending writes.`)
						return
					}
					connection.pending++
					tail = tail
						.then(async () => {
							if (!current()) {
								reject(
									requestId,
									`lease-lost`,
									`Write lease was lost before acceptance.`,
								)
								return
							}
							let parsed
							try {
								parsed = await options.schema[`~standard`].validate(
									input[`value`],
								)
							} catch {
								reject(requestId, `invalid`, `Value validation failed.`)
								return
							}
							if (parsed.issues) {
								reject(requestId, `invalid`, `Value validation failed.`)
								return
							}
							if (!current()) {
								reject(
									requestId,
									`lease-lost`,
									`Write lease was lost during validation.`,
								)
								return
							}
							if (
								!permitted(connection, `read`) ||
								!permitted(connection, `write`)
							) {
								reject(
									requestId,
									`unauthorized`,
									`Write permission was revoked.`,
								)
								revalidate()
								return
							}
							if (
								input[`epoch`] !== epoch ||
								!isRigidRevision(input[`revision`]) ||
								input[`revision`] !== revision
							) {
								reject(
									requestId,
									`conflict`,
									`The authoritative version changed. Read the current value before retrying.`,
								)
								return
							}
							setIntoStore(options.store, options.token, parsed.value)
							send(connection, {
								kind: `result`,
								requestId,
								status: `accepted`,
								snapshot: snapshot(),
							})
						})
						.catch(() => {
							reject(
								requestId,
								`unavailable`,
								`The write could not be completed.`,
							)
						})
						.finally(() => {
							connection.pending--
						})
				},
			)
			const stopDisconnect = employSocket(socket, `disconnect`, () => {
				connection.dispose()
			})
			connection.dispose = () => {
				if (!connection.active) return
				connection.active = false
				connection.subscription = null
				release(connection)
				stopRequest()
				stopDisconnect()
				connections.delete(connection)
			}
			return connection.dispose
		},
		dispose() {
			if (disposed) return
			disposed = true
			owned.delete(options.token.key)
			for (const connection of connections) connection.dispose()
			stopState()
		},
	}
}
