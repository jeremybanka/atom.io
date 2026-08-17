import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_PRESENCE_EVENTS,
	type MosaicDomainPresenceRequest,
	type MosaicDomainPresenceResponse,
	type MosaicDomainPresenceSnapshotRequest,
	type MosaicDomainPresenceSnapshotResponse,
} from "atom.io/realtime"

import type { MosaicDomainPresenceConnection } from "./mosaic-domain-presence-server.ts"

export type MosaicDomainPresenceServerSocket = {
	emit(event: string, payload: Json.Serializable): void
	off(event: string, listener?: (payload: any) => void): void
	on(event: string, listener: (payload: any) => void): void
}

export type MosaicDomainPresenceWorkTracker = {
	track<Value>(work: PromiseLike<Value>, label?: string): Promise<Value>
}

/** Bind a presence connection to ordinary named socket events. */
export function bindMosaicDomainPresenceServerSocket(
	connection: MosaicDomainPresenceConnection,
	socket: MosaicDomainPresenceServerSocket,
	work?: MosaicDomainPresenceWorkTracker,
): () => Promise<void> {
	let disposed = false
	const track = <Value>(
		promise: Promise<Value>,
		label: string,
	): Promise<Value> => work?.track(promise, label) ?? promise
	const onProposal = (input: unknown): void => {
		let request: MosaicDomainPresenceRequest
		try {
			request = structuredClone(input) as MosaicDomainPresenceRequest
		} catch {
			return
		}
		if (
			typeof request !== `object` ||
			request === null ||
			typeof request.requestId !== `string` ||
			request.requestId.length === 0 ||
			!(`proposal` in request)
		) {
			return
		}
		void track(
			connection.publish(request.proposal).then((result) => {
				if (disposed) return
				const response: MosaicDomainPresenceResponse = {
					requestId: request.requestId,
					result,
				}
				socket.emit(MOSAIC_DOMAIN_PRESENCE_EVENTS.result, response)
			}),
			`mosaic presence proposal`,
		).catch(() => undefined)
	}
	const onSnapshot = (input: unknown): void => {
		let request: MosaicDomainPresenceSnapshotRequest
		try {
			request = structuredClone(input) as MosaicDomainPresenceSnapshotRequest
		} catch {
			return
		}
		if (
			typeof request !== `object` ||
			request === null ||
			typeof request.requestId !== `string` ||
			request.requestId.length === 0
		) {
			return
		}
		void track(
			connection.snapshot().then((snapshot) => {
				if (disposed) return
				const response: MosaicDomainPresenceSnapshotResponse = {
					requestId: request.requestId,
					snapshot,
				}
				socket.emit(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshotResult, response)
			}),
			`mosaic presence snapshot`,
		).catch(() => undefined)
	}
	const unsubscribe = connection.subscribe((presence) => {
		if (!disposed) {
			socket.emit(MOSAIC_DOMAIN_PRESENCE_EVENTS.accepted, presence)
		}
	})
	socket.on(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, onProposal)
	socket.on(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot, onSnapshot)
	const cleanup = async (): Promise<void> => {
		if (disposed) return
		disposed = true
		socket.off(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, onProposal)
		socket.off(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot, onSnapshot)
		socket.off(`disconnect`, onDisconnect)
		const failures: unknown[] = []
		try {
			unsubscribe()
		} catch (error) {
			failures.push(error)
		}
		try {
			await connection.disconnect()
		} catch (error) {
			failures.push(error)
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				`Mosaic Domain presence socket cleanup failed.`,
			)
		}
	}
	const onDisconnect = (): void => {
		void cleanup().catch(() => undefined)
	}
	socket.on(`disconnect`, onDisconnect)
	return cleanup
}
