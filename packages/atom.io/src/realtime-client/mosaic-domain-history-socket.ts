import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_HISTORY_EVENTS,
	type MosaicDomainHistoryRequest,
	type MosaicDomainHistoryRequestResult,
	type MosaicDomainHistorySnapshot,
	type MosaicDomainHistorySnapshotSocketRequest,
	type MosaicDomainHistorySocketRequest,
	type MosaicDomainHistorySocketResponse,
} from "atom.io/realtime"

import type { MosaicDomainHistoryClientTransport } from "./mosaic-domain-history-client.ts"

export type MosaicDomainHistoryClientSocket = {
	emit(event: string, payload: Json.Serializable): void
	off(event: string, listener?: (payload: any) => void): void
	on(event: string, listener: (payload: any) => void): void
}

type Pending<Value> = {
	readonly reject: (reason: unknown) => void
	readonly resolve: (value: Value) => void
	readonly timer: ReturnType<typeof setTimeout>
}

/** Adapt the authenticated MOS-16 socket protocol to the history controller. */
export function createMosaicDomainHistorySocketTransport(
	socket: MosaicDomainHistoryClientSocket,
	options: {
		readonly idSource?: () => string
		readonly maxPendingRequests?: number
		readonly requestTimeoutMs?: number
	} = {},
): MosaicDomainHistoryClientTransport & Disposable {
	const maxPendingRequests = options.maxPendingRequests ?? 16
	const requestTimeoutMs = options.requestTimeoutMs ?? 5_000
	if (
		!Number.isSafeInteger(maxPendingRequests) ||
		maxPendingRequests < 1 ||
		!Number.isSafeInteger(requestTimeoutMs) ||
		requestTimeoutMs < 1
	) {
		throw new Error(`History socket limits must be positive integers.`)
	}
	let disposed = false
	let sequence = 0
	const idSource =
		options.idSource ?? (() => `history-socket:${(++sequence).toString()}`)
	const requests = new Map<string, Pending<MosaicDomainHistoryRequestResult>>()
	const snapshots = new Map<string, Pending<MosaicDomainHistorySnapshot>>()
	const nextRequestId = (): string => {
		if (requests.size + snapshots.size >= maxPendingRequests) {
			throw new Error(`History socket request queue is full.`)
		}
		const id = idSource()
		if (
			typeof id !== `string` ||
			id.length === 0 ||
			requests.has(id) ||
			snapshots.has(id)
		) {
			throw new Error(`History socket request IDs must be unique and nonempty.`)
		}
		return id
	}
	const settle = <Value>(
		pending: Map<string, Pending<Value>>,
		response: unknown,
	): void => {
		if (typeof response !== `object` || response === null) return
		const requestId = (response as { readonly requestId?: unknown }).requestId
		if (typeof requestId !== `string`) return
		const request = pending.get(requestId)
		if (request === undefined) return
		pending.delete(requestId)
		clearTimeout(request.timer)
		const candidate = response as {
			readonly error?: unknown
			readonly ok?: unknown
			readonly value?: unknown
		}
		if (candidate.ok === true) {
			request.resolve(candidate.value as Value)
			return
		}
		if (candidate.ok !== false) {
			request.reject(new Error(`History socket response is invalid.`))
			return
		}
		const reason = (candidate.error as { readonly reason?: unknown } | undefined)
			?.reason
		request.reject(
			new Error(
				typeof reason === `string`
					? reason
					: `History socket response is invalid.`,
			),
		)
	}
	const onResponse = (
		response: MosaicDomainHistorySocketResponse<MosaicDomainHistoryRequestResult>,
	): void => {
		settle(requests, response)
	}
	const onSnapshotResponse = (
		response: MosaicDomainHistorySocketResponse<MosaicDomainHistorySnapshot>,
	): void => {
		settle(snapshots, response)
	}
	const rejectAll = (reason: Error): void => {
		for (const request of [...requests.values(), ...snapshots.values()]) {
			clearTimeout(request.timer)
			request.reject(reason)
		}
		requests.clear()
		snapshots.clear()
	}
	const onDisconnect = (): void => {
		rejectAll(new Error(`History socket disconnected before acknowledgement.`))
	}
	const ask = <Value>(requestOptions: {
		readonly event: string
		readonly payload: (requestId: string) => Json.Serializable
		readonly pending: Map<string, Pending<Value>>
		readonly timeoutMessage: string
	}): Promise<Value> => {
		if (disposed)
			return Promise.reject(new Error(`History transport is disposed.`))
		let requestId: string
		try {
			requestId = nextRequestId()
		} catch (error) {
			return Promise.reject(error)
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				requestOptions.pending.delete(requestId)
				reject(new Error(requestOptions.timeoutMessage))
			}, requestTimeoutMs)
			;(timer as { unref?: () => void }).unref?.()
			requestOptions.pending.set(requestId, { reject, resolve, timer })
			try {
				socket.emit(requestOptions.event, requestOptions.payload(requestId))
			} catch (error) {
				clearTimeout(timer)
				requestOptions.pending.delete(requestId)
				reject(error)
			}
		})
	}
	socket.on(MOSAIC_DOMAIN_HISTORY_EVENTS.response, onResponse)
	socket.on(MOSAIC_DOMAIN_HISTORY_EVENTS.snapshotResponse, onSnapshotResponse)
	socket.on(`disconnect`, onDisconnect)
	return {
		request(request: MosaicDomainHistoryRequest) {
			return ask({
				event: MOSAIC_DOMAIN_HISTORY_EVENTS.request,
				payload: (requestId) =>
					({
						command: {
							cursor: request.cursor,
							id: request.id,
							mode: request.mode,
							sequence: request.sequence,
						},
						requestId,
					}) satisfies MosaicDomainHistorySocketRequest,
				pending: requests,
				timeoutMessage: `History socket request timed out.`,
			})
		},
		snapshot() {
			return ask({
				event: MOSAIC_DOMAIN_HISTORY_EVENTS.snapshot,
				payload: (requestId) =>
					({ requestId }) satisfies MosaicDomainHistorySnapshotSocketRequest,
				pending: snapshots,
				timeoutMessage: `History socket snapshot timed out.`,
			})
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			rejectAll(new Error(`History transport is disposed.`))
			socket.off(MOSAIC_DOMAIN_HISTORY_EVENTS.response, onResponse)
			socket.off(
				MOSAIC_DOMAIN_HISTORY_EVENTS.snapshotResponse,
				onSnapshotResponse,
			)
			socket.off(`disconnect`, onDisconnect)
		},
	}
}
