import { Silo } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type { MosaicDomainBatchProposal } from "atom.io/realtime"
import {
	bindMosaicDomainPresenceServerSocket,
	createMosaicDomainBatchServer,
	createMosaicDomainCheckpointCoordinator,
	createMosaicDomainPresenceServer,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainBatchAuthorizationContext,
	type MosaicDomainBatchConnection,
	type MosaicDomainCheckpointCoordinator,
	type MosaicDomainCheckpointStorageAdapter,
} from "atom.io/realtime-server"
import type { Socket as ServerSocket } from "socket.io"

import {
	activateSvgDesignDomain,
	type SvgDesignDomain,
	type SvgDomainState,
} from "../src/design-model.ts"
import {
	VECTOR_BATCH_EVENTS,
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
		authorize: options.authorize,
		domain,
		storage,
	})
	const checkpoints = createMosaicDomainCheckpointCoordinator({
		domain: domain.identity,
		readMember: async ({ address, revision }) => {
			if (revision !== batchServer.revision) {
				throw new Error(
					`Plane checkpoints require a quiescent accepted revision.`,
				)
			}
			const parsed = await domain.parseAddress(address)
			const acquired = await domain.acquire(parsed)
			return readState(acquired.token) as Json.Serializable
		},
		storage,
	})
	const presenceServer = createMosaicDomainPresenceServer({ domain })
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
			(value) => respond({ ok: true, value }),
			(error: unknown) =>
				respond({
					ok: false,
					reason: error instanceof Error ? error.message : String(error),
				}),
		)
	}

	return {
		async bindSocket({ actor, session, socket }) {
			if (disposed) throw new Error(`The vector service is disposed.`)
			const batch = batchServer.connect({ actor, session })
			const presence = presenceServer.connect({ actor, session })
			const unsubscribeBatch = batch.subscribe((accepted) => {
				socket.emit(VECTOR_BATCH_EVENTS.accepted, accepted)
			})
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
			socket.on(VECTOR_BATCH_EVENTS.propose, onPropose)
			socket.on(VECTOR_BATCH_EVENTS.recover, onRecover)
			let cleaned = false
			const cleanup = async (): Promise<void> => {
				if (cleaned) return
				cleaned = true
				socket.off(VECTOR_BATCH_EVENTS.propose, onPropose)
				socket.off(VECTOR_BATCH_EVENTS.recover, onRecover)
				socket.off(`disconnect`, onDisconnect)
				unsubscribeBatch()
				await unbindPresence()
				cleanups.delete(cleanup)
			}
			const onDisconnect = (): void => {
				void cleanup().catch(() => undefined)
			}
			socket.on(`disconnect`, onDisconnect)
			cleanups.add(cleanup)
			return cleanup
		},
		checkpoints: {
			checkpoint: () => exclusively(() => checkpoints.checkpoint()),
			readIndex: checkpoints.readIndex,
			recover: checkpoints.recover,
		},
		domain,
		get revision() {
			return batchServer.revision
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			for (const cleanup of cleanups) void cleanup().catch(() => undefined)
			cleanups.clear()
			presenceServer[Symbol.dispose]()
			batchServer.dispose()
			domain[Symbol.dispose]()
		},
	}
}
