import { Silo } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type {
	MosaicDomainBatchProposal,
	MosaicDomainResidencyTransport,
} from "atom.io/realtime"
import {
	bindMosaicDomainHistoryServerSocket,
	bindMosaicDomainPresenceServerSocket,
	createMosaicDomainBatchServer,
	createMosaicDomainCheckpointCoordinator,
	createMosaicDomainHistoryCoordinator,
	createMosaicDomainPresenceServer,
	createMosaicDomainResidencyServer,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainBatchAuthorizationContext,
	type MosaicDomainBatchConnection,
	type MosaicDomainCheckpointCoordinator,
	type MosaicDomainCheckpointStorageAdapter,
	type MosaicDomainHistoryCoordinator,
} from "atom.io/realtime-server"
import type { Socket as ServerSocket } from "socket.io"

import {
	activateSvgDesignDomain,
	type SvgDesignDomain,
	type SvgDomainState,
} from "../src/design-model.ts"
import {
	VECTOR_BATCH_EVENTS,
	VECTOR_RESIDENCY_EVENTS,
	type VectorAcknowledgement,
} from "../src/protocol.ts"

export type VectorCollaborationService = Disposable & {
	bindSocket(options: {
		readonly actor: string
		readonly session: string
		readonly socket: ServerSocket
	}): Promise<() => Promise<void>>
	readonly checkpoints: MosaicDomainCheckpointCoordinator<
		SvgDesignDomain[`identity`]
	>
	readonly domain: SvgDesignDomain
	readonly history: MosaicDomainHistoryCoordinator<SvgDesignDomain[`identity`]>
	readonly revision: number
}

export async function createVectorCollaborationService(
	options: {
		readonly authorize?: (
			context: MosaicDomainBatchAuthorizationContext,
		) => boolean | Promise<boolean>
		readonly silo?: Silo
		readonly storage?: MosaicDomainCheckpointStorageAdapter
	} = {},
): Promise<VectorCollaborationService> {
	const silo =
		options.silo ??
		new Silo({
			name: `vector-collaboration-server`,
			// Domain families acquire physical members from authenticated addresses.
			lifespan: `ephemeral`,
			isProduction: process.env.NODE_ENV === `production`,
		})
	const storage = options.storage ?? new InMemoryMosaicDomainCheckpointStorage()
	const domain = await activateSvgDesignDomain({
		instance: `shared-drawing`,
		silo,
	})
	const readState = silo.getState as SvgDomainState[`getState`]
	const batchServer = createMosaicDomainBatchServer({
		...(options.authorize === undefined ? {} : { authorize: options.authorize }),
		domain,
		storage,
	})
	let history!: MosaicDomainHistoryCoordinator<SvgDesignDomain[`identity`]>
	const checkpoints = createMosaicDomainCheckpointCoordinator({
		domain: domain.identity,
		indexes: (context) => history.checkpoint.indexes(context),
		readMember: async ({ address, revision }) => {
			if (revision !== batchServer.revision) {
				throw new Error(
					`Plane checkpoints require a quiescent accepted revision.`,
				)
			}
			const parsed = await domain.parseAddress(address)
			const acquired = await domain.acquire(parsed)
			return history.checkpoint.compactMember({
				address,
				revision,
				value: readState(acquired.token) as Json.Serializable,
			})
		},
		storage,
	})
	history = createMosaicDomainHistoryCoordinator({
		batches: batchServer,
		checkpoint: checkpoints,
		domain,
		storage,
	})
	const presenceServer = createMosaicDomainPresenceServer({ domain })
	const residencyServer = createMosaicDomainResidencyServer({
		batches: batchServer,
		checkpoint: checkpoints,
		domain,
		maxResidentMembers: 512,
	})
	type VectorResidencyTransport = MosaicDomainResidencyTransport<
		SvgDesignDomain[`identity`]
	>
	const cleanups = new Set<() => Promise<void>>()
	let disposed = false
	let serial = Promise.resolve()
	const exclusively = <Value>(work: () => Promise<Value>): Promise<Value> => {
		const result = serial.then(work)
		serial = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
	const acknowledge = <Value>(
		work: Promise<Value>,
		respond: (acknowledgement: VectorAcknowledgement<Value>) => void,
	): void => {
		void work.then(
			(value) => {
				respond({ ok: true, value })
			},
			(error: unknown) => {
				respond({
					ok: false,
					reason: error instanceof Error ? error.message : String(error),
				})
			},
		)
	}

	return {
		bindSocket({ actor, session, socket }) {
			if (disposed) {
				return Promise.reject(new Error(`The vector service is disposed.`))
			}
			const batch = batchServer.connect({ actor, session })
			const presence = presenceServer.connect({ actor, session })
			const residency = residencyServer.connect({ actor, session })
			const unbindHistory = bindMosaicDomainHistoryServerSocket(
				history.connect({ actor, session }),
				socket,
				{ session },
			)
			const unsubscribeBatch = batch.subscribe((accepted) => {
				socket.emit(VECTOR_BATCH_EVENTS.accepted, accepted)
			})
			const residencySubscriptions = new Map<string, () => void>()
			const unbindPresence = bindMosaicDomainPresenceServerSocket(
				presence,
				socket,
			)
			const onPropose = (
				proposal: MosaicDomainBatchProposal,
				respond: (
					acknowledgement: VectorAcknowledgement<
						Awaited<ReturnType<MosaicDomainBatchConnection[`propose`]>>
					>,
				) => void,
			): void => {
				acknowledge(
					exclusively(() => batch.propose(proposal)),
					respond,
				)
			}
			const onRecover = (
				afterRevision: number,
				respond: (
					acknowledgement: VectorAcknowledgement<
						Awaited<ReturnType<MosaicDomainBatchConnection[`recover`]>>
					>,
				) => void,
			): void => {
				acknowledge(batch.recover(afterRevision), respond)
			}
			const onResidencyHydrate = (
				requests: unknown,
				respond: (
					acknowledgement: VectorAcknowledgement<
						Awaited<ReturnType<VectorResidencyTransport[`hydrate`]>>
					>,
				) => void,
			): void => {
				acknowledge(residency.hydrate(requests as never), respond)
			}
			const onResidencyPropose = (
				proposal: unknown,
				respond: (
					acknowledgement: VectorAcknowledgement<
						Awaited<ReturnType<VectorResidencyTransport[`propose`]>>
					>,
				) => void,
			): void => {
				acknowledge(residency.propose(proposal as never), respond)
			}
			const onResidencySubscribe = (
				id: string,
				requests: unknown,
				respond: (acknowledgement: VectorAcknowledgement<void>) => void,
			): void => {
				acknowledge(
					Promise.resolve(
						residency.subscribe(requests as never, (accepted) => {
							socket.emit(VECTOR_RESIDENCY_EVENTS.accepted, id, accepted)
						}),
					).then((stop) => {
						residencySubscriptions.get(id)?.()
						residencySubscriptions.set(id, stop)
					}),
					respond,
				)
			}
			const onResidencyUnsubscribe = (id: string): void => {
				residencySubscriptions.get(id)?.()
				residencySubscriptions.delete(id)
			}
			socket.on(VECTOR_BATCH_EVENTS.propose, onPropose)
			socket.on(VECTOR_BATCH_EVENTS.recover, onRecover)
			socket.on(VECTOR_RESIDENCY_EVENTS.hydrate, onResidencyHydrate)
			socket.on(VECTOR_RESIDENCY_EVENTS.propose, onResidencyPropose)
			socket.on(VECTOR_RESIDENCY_EVENTS.subscribe, onResidencySubscribe)
			socket.on(VECTOR_RESIDENCY_EVENTS.unsubscribe, onResidencyUnsubscribe)
			let cleaned = false
			const cleanup = async (): Promise<void> => {
				if (cleaned) return
				cleaned = true
				socket.off(VECTOR_BATCH_EVENTS.propose, onPropose)
				socket.off(VECTOR_BATCH_EVENTS.recover, onRecover)
				socket.off(`disconnect`, onDisconnect)
				unsubscribeBatch()
				for (const stop of residencySubscriptions.values()) stop()
				residencySubscriptions.clear()
				socket.off(VECTOR_RESIDENCY_EVENTS.hydrate, onResidencyHydrate)
				socket.off(VECTOR_RESIDENCY_EVENTS.propose, onResidencyPropose)
				socket.off(VECTOR_RESIDENCY_EVENTS.subscribe, onResidencySubscribe)
				socket.off(VECTOR_RESIDENCY_EVENTS.unsubscribe, onResidencyUnsubscribe)
				await Promise.resolve(residency.dispose?.()).catch(() => undefined)
				unbindHistory()
				await unbindPresence()
				cleanups.delete(cleanup)
			}
			const onDisconnect = (): void => {
				void cleanup().catch(() => undefined)
			}
			socket.on(`disconnect`, onDisconnect)
			cleanups.add(cleanup)
			return Promise.resolve(cleanup)
		},
		checkpoints: {
			checkpoint: () => exclusively(() => checkpoints.checkpoint()),
			readIndex: checkpoints.readIndex,
			recover: checkpoints.recover,
		},
		domain,
		history,
		get revision() {
			return batchServer.revision
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			for (const cleanup of cleanups) void cleanup().catch(() => undefined)
			cleanups.clear()
			presenceServer[Symbol.dispose]()
			residencyServer[Symbol.dispose]()
			history[Symbol.dispose]()
			batchServer.dispose()
			domain[Symbol.dispose]()
		},
	}
}
