import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_PRESENCE_EVENTS,
	type MosaicDomainPresenceEnvelope,
	type MosaicDomainPresenceRequest,
	type MosaicDomainPresenceResponse,
	type MosaicDomainPresenceSnapshotRequest,
	type MosaicDomainPresenceSnapshotResponse,
} from "atom.io/realtime"

import type { MosaicDomainPresenceClientTransport } from "./mosaic-domain-presence-client.ts"

export type MosaicDomainPresenceClientSocket = {
	emit(event: string, payload: Json.Serializable): void
	off(event: string, listener?: (payload: any) => void): void
	on(event: string, listener: (payload: any) => void): void
}

/** Adapt named socket events to the transport-neutral presence controller. */
export function createMosaicDomainPresenceSocketTransport(
	socket: MosaicDomainPresenceClientSocket,
	options: {
		readonly idSource?: () => string
		readonly maxPendingRequests?: number
		readonly requestTimeoutMs?: number
	} = {},
): MosaicDomainPresenceClientTransport & Disposable {
	let sequence = 0
	let disposed = false
	const maxPendingRequests = options.maxPendingRequests ?? 64
	const requestTimeoutMs = options.requestTimeoutMs ?? 5_000
	if (
		!Number.isSafeInteger(maxPendingRequests) ||
		maxPendingRequests < 1 ||
		!Number.isSafeInteger(requestTimeoutMs) ||
		requestTimeoutMs < 1
	) {
		throw new Error(`Presence socket limits must be positive integers.`)
	}
	const idSource =
		options.idSource ?? (() => `presence-request:${(sequence++).toString()}`)
	const proposalRequests = new Map<
		string,
		{
			readonly reject: (reason: unknown) => void
			readonly resolve: (result: MosaicDomainPresenceResponse[`result`]) => void
			readonly timer: ReturnType<typeof setTimeout>
		}
	>()
	const snapshotRequests = new Map<
		string,
		{
			readonly reject: (reason: unknown) => void
			readonly resolve: (
				snapshot: MosaicDomainPresenceSnapshotResponse[`snapshot`],
			) => void
			readonly timer: ReturnType<typeof setTimeout>
		}
	>()
	const listeners = new Set<(presence: MosaicDomainPresenceEnvelope) => void>()
	const nextRequestId = (): string => {
		if (proposalRequests.size + snapshotRequests.size >= maxPendingRequests) {
			throw new Error(`Presence socket request queue is full.`)
		}
		const requestId = idSource()
		if (
			typeof requestId !== `string` ||
			requestId.length === 0 ||
			proposalRequests.has(requestId) ||
			snapshotRequests.has(requestId)
		) {
			throw new Error(`Presence socket request IDs must be unique and nonempty.`)
		}
		return requestId
	}
	const onAccepted = (presence: MosaicDomainPresenceEnvelope): void => {
		for (const listener of listeners) {
			try {
				listener(structuredClone(presence))
			} catch {
				// A consumer cannot prevent delivery to the remaining subscribers.
			}
		}
	}
	const onResult = (response: MosaicDomainPresenceResponse): void => {
		if (typeof response?.requestId !== `string`) return
		const request = proposalRequests.get(response.requestId)
		if (request === undefined) return
		proposalRequests.delete(response.requestId)
		clearTimeout(request.timer)
		request.resolve(response.result)
	}
	const onSnapshotResult = (
		response: MosaicDomainPresenceSnapshotResponse,
	): void => {
		if (typeof response?.requestId !== `string`) return
		const request = snapshotRequests.get(response.requestId)
		if (request === undefined) return
		snapshotRequests.delete(response.requestId)
		clearTimeout(request.timer)
		request.resolve(response.snapshot)
	}
	const onDisconnect = (): void => {
		const error = new Error(
			`Presence socket disconnected before acknowledgement.`,
		)
		for (const request of proposalRequests.values()) {
			clearTimeout(request.timer)
			request.reject(error)
		}
		for (const request of snapshotRequests.values()) {
			clearTimeout(request.timer)
			request.reject(error)
		}
		proposalRequests.clear()
		snapshotRequests.clear()
	}
	socket.on(MOSAIC_DOMAIN_PRESENCE_EVENTS.accepted, onAccepted)
	socket.on(MOSAIC_DOMAIN_PRESENCE_EVENTS.result, onResult)
	socket.on(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshotResult, onSnapshotResult)
	socket.on(`disconnect`, onDisconnect)
	return {
		publish(proposal) {
			if (disposed)
				return Promise.reject(new Error(`Presence transport is disposed.`))
			let requestId: string
			try {
				requestId = nextRequestId()
			} catch (error) {
				return Promise.reject(error)
			}
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					proposalRequests.delete(requestId)
					reject(new Error(`Presence socket proposal timed out.`))
				}, requestTimeoutMs)
				if (`unref` in timer) timer.unref()
				proposalRequests.set(requestId, { reject, resolve, timer })
				const request: MosaicDomainPresenceRequest = { proposal, requestId }
				socket.emit(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, request)
			})
		},
		snapshot() {
			if (disposed)
				return Promise.reject(new Error(`Presence transport is disposed.`))
			let requestId: string
			try {
				requestId = nextRequestId()
			} catch (error) {
				return Promise.reject(error)
			}
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					snapshotRequests.delete(requestId)
					reject(new Error(`Presence socket snapshot timed out.`))
				}, requestTimeoutMs)
				if (`unref` in timer) timer.unref()
				snapshotRequests.set(requestId, { reject, resolve, timer })
				const request: MosaicDomainPresenceSnapshotRequest = { requestId }
				socket.emit(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot, request)
			})
		},
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			onDisconnect()
			socket.off(MOSAIC_DOMAIN_PRESENCE_EVENTS.accepted, onAccepted)
			socket.off(MOSAIC_DOMAIN_PRESENCE_EVENTS.result, onResult)
			socket.off(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshotResult, onSnapshotResult)
			socket.off(`disconnect`, onDisconnect)
			listeners.clear()
		},
	}
}
