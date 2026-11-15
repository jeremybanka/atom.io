import {
	employSocket,
	encodeRealtimePayload,
	isRigidRecord,
	isRigidRevision,
	type RigidMutableStatus,
	type Socket,
	type VersionedMutablePullOptions,
} from "@atom.io/realtime"
import type { MutableAtomToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	type AsJSON,
	getJsonTokenFromStore,
	getUpdateToken,
	setIntoStore,
	type SignalFrom,
	type Store,
	type Transceiver,
} from "atom.io/internal"

import { createSubscriber, getSubMap } from "./create-subscriber.ts"

type StreamRegistration = {
	store: Store
	snapshotSchema: object
	signalSchema: object
	clock: unknown
	maxPending: number
	maxBytes: number
	listeners: Set<(status: RigidMutableStatus) => void>
	status: RigidMutableStatus | null
}
const streams = new WeakMap<Socket, Map<string, StreamRegistration>>()

export function pullVersionedMutable<T extends Transceiver<any, any, any>>(
	store: Store,
	socket: Socket,
	token: MutableAtomToken<T>,
	request: (metadata: {
		protocol: `rigid-mutable-v1`
		subscription: string
	}) => void,
	options: VersionedMutablePullOptions<AsJSON<T>, SignalFrom<T>>,
	unavailable?: { event: string; matches: (key: Json.Serializable) => boolean },
): () => void {
	const maxPending = options.maxPendingMessages ?? 64
	const maxBytes = options.maxMessageBytes ?? 1_048_576
	for (const limit of [maxPending, maxBytes])
		if (!Number.isSafeInteger(limit) || limit < 1)
			throw new Error(`Mutable stream limits must be positive safe integers`)
	if (getSubMap(socket).has(token.key))
		throw new Error(
			`Cannot mix raw and versioned mutable consumers for one socket/token`,
		)
	let registrations = streams.get(socket)
	if (!registrations) {
		registrations = new Map()
		streams.set(socket, registrations)
	}
	let registration = registrations.get(token.key)
	if (
		registration &&
		(registration.store !== store ||
			registration.snapshotSchema !== options.snapshotSchema ||
			registration.signalSchema !== options.signalSchema ||
			registration.clock !== options.clock ||
			registration.maxPending !== maxPending ||
			registration.maxBytes !== maxBytes)
	)
		throw new Error(
			`Shared mutable consumers must use the same Store, schemas, clock and limits`,
		)
	if (!registration) {
		registration = {
			store,
			snapshotSchema: options.snapshotSchema,
			signalSchema: options.signalSchema,
			clock: options.clock,
			maxPending,
			maxBytes,
			listeners: new Set(),
			status: null,
		}
		registrations.set(token.key, registration)
	}
	const shared = registration
	const listener = (status: RigidMutableStatus): void => {
		try {
			options.onStatus?.(status)
		} catch {}
	}
	shared.listeners.add(listener)
	if (shared.status) listener(shared.status)
	const release = createSubscriber(
		socket,
		`versioned-mutable:${token.key}`,
		() => {
			registrations.set(token.key, shared)
			const jsonToken = getJsonTokenFromStore(store, token)
			const updateToken = getUpdateToken(token)
			let subscription = ``
			let epoch: string | null = null
			let revision = -1
			let disposed = false
			let pending = 0
			let failed = false
			let revoked = false
			let tail = Promise.resolve()
			const report = (
				status: `hydrating` | `live` | `revoked` | `failed`,
			): void => {
				shared.status = {
					status,
					epoch,
					revision: revision < 0 ? null : revision,
				}
				for (const observer of shared.listeners) observer(shared.status)
			}
			const hydrate = (): void => {
				subscription = crypto.randomUUID()
				epoch = null
				revision = -1
				report(`hydrating`)
				request({ protocol: `rigid-mutable-v1`, subscription })
			}
			const fail = (): void => {
				failed = true
				epoch = null
				revision = -1
				socket.emit(`unsub:${token.key}`)
				report(`failed`)
			}
			const receive = (kind: `init` | `next`, input: unknown): void => {
				const encoded = encodeRealtimePayload(input, maxBytes)
				if (encoded === null) {
					fail()
					return
				}
				const value: unknown = JSON.parse(encoded)
				if (
					disposed ||
					failed ||
					!isRigidRecord(value) ||
					value[`subscription`] !== subscription
				)
					return
				if (
					value[`protocol`] !== `rigid-mutable-v1` ||
					typeof value[`epoch`] !== `string` ||
					!isRigidRevision(value[`revision`])
				) {
					fail()
					return
				}
				if (pending >= maxPending) {
					fail()
					return
				}
				const expectedSubscription = subscription
				pending++
				tail = tail
					.then(async () => {
						if (disposed || failed || subscription !== expectedSubscription)
							return
						if (
							kind === `next` &&
							(epoch === null ||
								value[`epoch`] !== epoch ||
								value[`revision`] !== revision + 1)
						) {
							if (
								value[`epoch`] === epoch &&
								(value[`revision`] as number) <= revision
							)
								return
							hydrate()
							return
						}
						if (kind === `init` && epoch !== null) {
							if (value[`epoch`] !== epoch) {
								hydrate()
								return
							}
							if ((value[`revision`] as number) <= revision) return
						}
						const schema =
							kind === `init` ? options.snapshotSchema : options.signalSchema
						const parsed = await schema[`~standard`].validate(value[`value`])
						if (disposed || failed || subscription !== expectedSubscription)
							return
						if (parsed.issues) {
							fail()
							return
						}
						if (kind === `init`)
							setIntoStore(store, jsonToken, parsed.value as AsJSON<T>)
						else setIntoStore(store, updateToken, parsed.value as SignalFrom<T>)
						epoch = value[`epoch`] as string
						revision = value[`revision`] as number
						revoked = false
						report(`live`)
					})
					.catch(() => {
						if (!disposed && subscription === expectedSubscription) fail()
					})
					.finally(() => {
						pending--
					})
			}
			const stopInit = employSocket(socket, `init:${token.key}`, (value) => {
				receive(`init`, value)
			})
			const stopNext = employSocket(socket, `next:${token.key}`, (value) => {
				receive(`next`, value)
			})
			const stopUnavailable = unavailable
				? employSocket(socket, unavailable.event, (key) => {
						if (!unavailable.matches(key)) return
						// A new nonce excludes snapshots/deltas already in flight at revocation.
						if (!revoked) {
							revoked = true
							hydrate()
						}
						epoch = null
						revision = -1
						report(`revoked`)
					})
				: () => {}
			const stopDisconnect = employSocket(socket, `disconnect`, () => {
				subscription = crypto.randomUUID()
				epoch = null
				revision = -1
				report(`hydrating`)
			})
			hydrate()
			return () => {
				registrations.delete(token.key)
				disposed = true
				socket.emit(`unsub:${token.key}`)
				stopInit()
				stopNext()
				stopUnavailable()
				stopDisconnect()
			}
		},
		options.clock ? { clock: options.clock } : {},
	)
	return () => {
		shared.listeners.delete(listener)
		release()
	}
}
