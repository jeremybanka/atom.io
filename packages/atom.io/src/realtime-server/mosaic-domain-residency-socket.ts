import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_RESIDENCY_EVENTS,
	type MosaicDomainResidencyAcceptedSocketEvent,
	type MosaicDomainResidencyHydrateSocketRequest,
	type MosaicDomainResidencyProposeSocketRequest,
	type MosaicDomainResidencySocketResponse,
	type MosaicDomainResidencySubscribeSocketRequest,
	type MosaicDomainResidencyTransport,
	type MosaicDomainResidencyUnsubscribeSocketRequest,
} from "atom.io/realtime"

export type MosaicDomainResidencyServerSocket = {
	emit(event: string, payload: Json.Serializable): void
	off(event: string, listener?: (payload: any) => void): void
	on(event: string, listener: (payload: any) => void): void
}

export type MosaicDomainResidencyWorkTracker = {
	track<Value>(work: PromiseLike<Value>, label?: string): Promise<Value>
}

const identifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

/** Bind one authenticated residency connection to the core socket protocol. */
export function bindMosaicDomainResidencyServerSocket(
	connection: MosaicDomainResidencyTransport,
	socket: MosaicDomainResidencyServerSocket,
	work?: MosaicDomainResidencyWorkTracker,
	options: { readonly maxSubscriptions?: number } = {},
): () => void {
	const maxSubscriptions = options.maxSubscriptions ?? 32
	if (!Number.isSafeInteger(maxSubscriptions) || maxSubscriptions < 1) {
		throw new Error(`Residency socket limits must be positive integers.`)
	}
	let disposed = false
	const subscriptions = new Map<string, () => void>()
	const pendingSubscriptions = new Set<string>()
	const track = <Value>(
		promise: Promise<Value>,
		label: string,
	): Promise<Value> => work?.track(promise, label) ?? promise
	const response = <Value>(
		event: string,
		requestId: string,
		promise: Promise<Value>,
	): void => {
		void track(promise, `mosaic domain residency socket request`).then(
			(value) => {
				if (disposed) return
				const result: MosaicDomainResidencySocketResponse<Value> = {
					ok: true,
					requestId,
					value,
				}
				socket.emit(event, result as Json.Serializable)
			},
			(error: unknown) => {
				if (disposed) return
				const result: MosaicDomainResidencySocketResponse<Value> = {
					error: {
						reason: error instanceof Error ? error.message : String(error),
					},
					ok: false,
					requestId,
				}
				socket.emit(event, result)
			},
		)
	}
	const clone = <Value>(input: unknown): Value | null => {
		try {
			return structuredClone(input) as Value
		} catch {
			return null
		}
	}
	const rejectInvalid = (event: string, requestId: string): void => {
		const result: MosaicDomainResidencySocketResponse<never> = {
			error: { reason: `A Mosaic Domain residency socket request is invalid.` },
			ok: false,
			requestId,
		}
		socket.emit(event, result)
	}
	const onHydrate = (input: unknown): void => {
		const request = clone<MosaicDomainResidencyHydrateSocketRequest>(input)
		if (request === null || !identifier(request.requestId)) return
		if (!Array.isArray(request.requests)) {
			rejectInvalid(
				MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrateResult,
				request.requestId,
			)
			return
		}
		response(
			MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrateResult,
			request.requestId,
			connection.hydrate(request.requests),
		)
	}
	const onPropose = (input: unknown): void => {
		const request = clone<MosaicDomainResidencyProposeSocketRequest>(input)
		if (request === null || !identifier(request.requestId)) return
		if (typeof request.proposal !== `object` || request.proposal === null) {
			rejectInvalid(
				MOSAIC_DOMAIN_RESIDENCY_EVENTS.proposeResult,
				request.requestId,
			)
			return
		}
		response(
			MOSAIC_DOMAIN_RESIDENCY_EVENTS.proposeResult,
			request.requestId,
			connection.propose(request.proposal),
		)
	}
	const onSubscribe = (input: unknown): void => {
		const request = clone<MosaicDomainResidencySubscribeSocketRequest>(input)
		if (
			request === null ||
			!identifier(request.requestId) ||
			!identifier(request.subscriptionId)
		) {
			return
		}
		if (!Array.isArray(request.requests)) {
			rejectInvalid(
				MOSAIC_DOMAIN_RESIDENCY_EVENTS.subscribeResult,
				request.requestId,
			)
			return
		}
		if (
			!subscriptions.has(request.subscriptionId) &&
			(pendingSubscriptions.has(request.subscriptionId) ||
				subscriptions.size + pendingSubscriptions.size >= maxSubscriptions)
		) {
			response(
				MOSAIC_DOMAIN_RESIDENCY_EVENTS.subscribeResult,
				request.requestId,
				Promise.reject(
					new Error(`Residency socket subscription limit is reached.`),
				),
			)
			return
		}
		pendingSubscriptions.add(request.subscriptionId)
		response(
			MOSAIC_DOMAIN_RESIDENCY_EVENTS.subscribeResult,
			request.requestId,
			Promise.resolve()
				.then(() =>
					connection.subscribe(request.requests, (accepted) => {
						if (disposed || !subscriptions.has(request.subscriptionId)) return
						const event: MosaicDomainResidencyAcceptedSocketEvent = {
							accepted,
							subscriptionId: request.subscriptionId,
						}
						socket.emit(MOSAIC_DOMAIN_RESIDENCY_EVENTS.accepted, event)
					}),
				)
				.then((stop) => {
					if (disposed) {
						stop()
						return
					}
					subscriptions.get(request.subscriptionId)?.()
					subscriptions.set(request.subscriptionId, stop)
				})
				.finally(() => pendingSubscriptions.delete(request.subscriptionId)),
		)
	}
	const onUnsubscribe = (input: unknown): void => {
		const request = clone<MosaicDomainResidencyUnsubscribeSocketRequest>(input)
		if (request === null || !identifier(request.subscriptionId)) return
		subscriptions.get(request.subscriptionId)?.()
		subscriptions.delete(request.subscriptionId)
	}
	const cleanup = (): void => {
		if (disposed) return
		disposed = true
		for (const stop of subscriptions.values()) stop()
		subscriptions.clear()
		pendingSubscriptions.clear()
		socket.off(MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrate, onHydrate)
		socket.off(MOSAIC_DOMAIN_RESIDENCY_EVENTS.propose, onPropose)
		socket.off(MOSAIC_DOMAIN_RESIDENCY_EVENTS.subscribe, onSubscribe)
		socket.off(MOSAIC_DOMAIN_RESIDENCY_EVENTS.unsubscribe, onUnsubscribe)
		socket.off(`disconnect`, onDisconnect)
		connection.dispose?.()
	}
	const onDisconnect = (): void => {
		cleanup()
	}
	socket.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrate, onHydrate)
	socket.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.propose, onPropose)
	socket.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.subscribe, onSubscribe)
	socket.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.unsubscribe, onUnsubscribe)
	socket.on(`disconnect`, onDisconnect)
	return cleanup
}
