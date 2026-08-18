import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_HISTORY_EVENTS,
	type MosaicDomainHistoryRequestResult,
	type MosaicDomainHistorySnapshot,
	type MosaicDomainHistorySnapshotSocketRequest,
	type MosaicDomainHistorySocketError,
	type MosaicDomainHistorySocketRequest,
	type MosaicDomainHistorySocketResponse,
} from "atom.io/realtime"

import type { MosaicDomainHistoryConnection } from "./mosaic-domain-history.ts"

export type MosaicDomainHistoryServerSocket = {
	emit(event: string, payload: Json.Serializable): void
	off(event: string, listener?: (payload: any) => void): void
	on(event: string, listener: (payload: any) => void): void
}

export type MosaicDomainHistoryWorkTracker = {
	track<Value>(work: PromiseLike<Value>, label?: string): Promise<Value>
}

const identifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

const socketError = (
	code: MosaicDomainHistorySocketError[`code`],
	reason: string,
	retryable: boolean,
): MosaicDomainHistorySocketError => ({ code, reason, retryable })

/** Bind one authenticated actor/session history connection to named events. */
export function bindMosaicDomainHistoryServerSocket(
	connection: MosaicDomainHistoryConnection,
	socket: MosaicDomainHistoryServerSocket,
	options: {
		readonly session: string
		readonly work?: MosaicDomainHistoryWorkTracker
	},
): () => void {
	if (!identifier(options.session)) {
		throw new Error(`Domain history requires an authenticated session ID.`)
	}
	let disposed = false
	const track = <Value>(work: Promise<Value>, label: string): Promise<Value> =>
		options.work?.track(work, label) ?? work
	const respond = <Value>(
		event: string,
		requestId: string,
		work: Promise<Value>,
	): void => {
		void track(work, `mosaic domain history socket request`).then(
			(value) => {
				if (disposed) return
				const response: MosaicDomainHistorySocketResponse<Value> = {
					ok: true,
					requestId,
					value,
				}
				socket.emit(event, response as Json.Serializable)
			},
			(error: unknown) => {
				if (disposed) return
				const response: MosaicDomainHistorySocketResponse<Value> = {
					error: socketError(
						`internal`,
						error instanceof Error ? error.message : String(error),
						true,
					),
					ok: false,
					requestId,
				}
				socket.emit(event, response)
			},
		)
	}
	const rejectInvalid = (event: string, requestId: string): void => {
		const response: MosaicDomainHistorySocketResponse<never> = {
			error: socketError(
				`invalid-request`,
				`A Mosaic Domain history socket request is invalid.`,
				false,
			),
			ok: false,
			requestId,
		}
		socket.emit(event, response)
	}
	const onRequest = (input: unknown): void => {
		let request: MosaicDomainHistorySocketRequest
		try {
			request = structuredClone(input) as MosaicDomainHistorySocketRequest
		} catch {
			return
		}
		if (
			typeof request !== `object` ||
			request === null ||
			!identifier(request.requestId) ||
			typeof request.command !== `object` ||
			request.command === null
		) {
			return
		}
		if (
			!identifier(request.command.id) ||
			(request.command.mode !== `undo` && request.command.mode !== `redo`) ||
			!Number.isSafeInteger(request.command.sequence) ||
			request.command.sequence < 1 ||
			typeof request.command.cursor !== `object` ||
			request.command.cursor === null
		) {
			rejectInvalid(MOSAIC_DOMAIN_HISTORY_EVENTS.response, request.requestId)
			return
		}
		respond<MosaicDomainHistoryRequestResult>(
			MOSAIC_DOMAIN_HISTORY_EVENTS.response,
			request.requestId,
			connection.request({ ...request.command, session: options.session }),
		)
	}
	const onSnapshot = (input: unknown): void => {
		let request: MosaicDomainHistorySnapshotSocketRequest
		try {
			request = structuredClone(
				input,
			) as MosaicDomainHistorySnapshotSocketRequest
		} catch {
			return
		}
		if (
			typeof request !== `object` ||
			request === null ||
			!identifier(request.requestId)
		) {
			return
		}
		respond<MosaicDomainHistorySnapshot>(
			MOSAIC_DOMAIN_HISTORY_EVENTS.snapshotResponse,
			request.requestId,
			connection.snapshot(),
		)
	}
	const cleanup = (): void => {
		if (disposed) return
		disposed = true
		socket.off(MOSAIC_DOMAIN_HISTORY_EVENTS.request, onRequest)
		socket.off(MOSAIC_DOMAIN_HISTORY_EVENTS.snapshot, onSnapshot)
		socket.off(`disconnect`, onDisconnect)
		connection[Symbol.dispose]()
	}
	const onDisconnect = (): void => {
		cleanup()
	}
	socket.on(MOSAIC_DOMAIN_HISTORY_EVENTS.request, onRequest)
	socket.on(MOSAIC_DOMAIN_HISTORY_EVENTS.snapshot, onSnapshot)
	socket.on(`disconnect`, onDisconnect)
	return cleanup
}
