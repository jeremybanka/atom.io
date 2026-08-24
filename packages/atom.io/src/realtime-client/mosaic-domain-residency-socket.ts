import type { Json } from "atom.io/foundations/json"
import {
	assertMosaicDomainResidencyAcceptedSlice,
	MOSAIC_DOMAIN_RESIDENCY_EVENTS,
	type MosaicDomainIdentity,
	type MosaicDomainResidencyAcceptedSlice,
	type MosaicDomainResidencyCheckpoint,
	type MosaicDomainResidencyHydrateSocketRequest,
	type MosaicDomainResidencyProposalResult,
	type MosaicDomainResidencyProposeSocketRequest,
	type MosaicDomainResidencyRequest,
	type MosaicDomainResidencySubscribeSocketRequest,
	type MosaicDomainResidencyTransport,
	type MosaicDomainResidencyUnsubscribeSocketRequest,
} from "atom.io/realtime"

export type MosaicDomainResidencyClientSocket = {
	emit(event: string, payload: Json.Serializable): void
	off(event: string, listener?: (payload: any) => void): void
	on(event: string, listener: (payload: any) => void): void
}

type Pending<Value> = {
	readonly reject: (reason: unknown) => void
	readonly resolve: (value: Value) => void
	readonly timer: ReturnType<typeof setTimeout>
}

/** Adapt the bounded residency protocol to ordinary named socket events. */
export function createMosaicDomainResidencySocketTransport<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable,
>(
	socket: MosaicDomainResidencyClientSocket,
	options: {
		readonly idSource?: () => string
		readonly maxPendingRequests?: number
		readonly maxSubscriptions?: number
		readonly requestTimeoutMs?: number
	} = {},
): MosaicDomainResidencyTransport<Identity, Range> & Disposable {
	const maxPendingRequests = options.maxPendingRequests ?? 32
	const maxSubscriptions = options.maxSubscriptions ?? 32
	const requestTimeoutMs = options.requestTimeoutMs ?? 5_000
	if (
		!Number.isSafeInteger(maxPendingRequests) ||
		maxPendingRequests < 1 ||
		!Number.isSafeInteger(maxSubscriptions) ||
		maxSubscriptions < 1 ||
		!Number.isSafeInteger(requestTimeoutMs) ||
		requestTimeoutMs < 1
	) {
		throw new Error(`Residency socket limits must be positive integers.`)
	}
	let disposed = false
	let sequence = 0
	const idSource =
		options.idSource ?? (() => `residency-socket:${(++sequence).toString()}`)
	const pending = new Map<string, Pending<unknown>>()
	const subscriptions = new Map<
		string,
		(accepted: MosaicDomainResidencyAcceptedSlice<Identity>) => void
	>()
	const nextId = (): string => {
		if (pending.size >= maxPendingRequests) {
			throw new Error(`Residency socket request queue is full.`)
		}
		const id = idSource()
		if (
			typeof id !== `string` ||
			id.length === 0 ||
			pending.has(id) ||
			subscriptions.has(id)
		) {
			throw new Error(
				`Residency socket request IDs must be unique and nonempty.`,
			)
		}
		return id
	}
	const settle = (response: unknown): void => {
		if (typeof response !== `object` || response === null) return
		const candidate = response as {
			readonly error?: unknown
			readonly ok?: unknown
			readonly requestId?: unknown
			readonly value?: unknown
		}
		if (typeof candidate.requestId !== `string`) return
		const request = pending.get(candidate.requestId)
		if (request === undefined) return
		pending.delete(candidate.requestId)
		clearTimeout(request.timer)
		if (candidate.ok === true) {
			request.resolve(candidate.value)
			return
		}
		const reason = (candidate.error as { readonly reason?: unknown } | undefined)
			?.reason
		request.reject(
			new Error(
				candidate.ok === false && typeof reason === `string`
					? reason
					: `Residency socket response is invalid.`,
			),
		)
	}
	const onAccepted = (event: unknown): void => {
		if (typeof event !== `object` || event === null) return
		const candidate = event as {
			readonly accepted?: unknown
			readonly subscriptionId?: unknown
		}
		if (typeof candidate.subscriptionId !== `string`) return
		const listener = subscriptions.get(candidate.subscriptionId)
		if (listener === undefined) return
		try {
			assertMosaicDomainResidencyAcceptedSlice(candidate.accepted)
			listener(structuredClone(candidate.accepted) as never)
		} catch {
			// Invalid or consumer-failing events cannot disrupt other subscriptions.
		}
	}
	const rejectAll = (reason: Error): void => {
		for (const request of pending.values()) {
			clearTimeout(request.timer)
			request.reject(reason)
		}
		pending.clear()
	}
	const onDisconnect = (): void => {
		rejectAll(new Error(`Residency socket disconnected before acknowledgement.`))
	}
	const ask = <Value>(
		event: string,
		payload: (id: string) => Json.Serializable,
	) => {
		if (disposed)
			return Promise.reject<Value>(new Error(`Residency transport is disposed.`))
		let requestId: string
		try {
			requestId = nextId()
		} catch (error) {
			return Promise.reject<Value>(error)
		}
		return new Promise<Value>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(requestId)
				reject(new Error(`Residency socket request timed out.`))
			}, requestTimeoutMs)
			;(timer as { unref?: () => void }).unref?.()
			pending.set(requestId, { reject, resolve, timer })
			try {
				socket.emit(event, payload(requestId))
			} catch (error) {
				clearTimeout(timer)
				pending.delete(requestId)
				reject(error)
			}
		})
	}
	socket.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrateResult, settle)
	socket.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.proposeResult, settle)
	socket.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.subscribeResult, settle)
	socket.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.accepted, onAccepted)
	socket.on(`disconnect`, onDisconnect)
	return {
		hydrate(requests: readonly MosaicDomainResidencyRequest<Identity, Range>[]) {
			return ask<MosaicDomainResidencyCheckpoint<Identity>>(
				MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrate,
				(requestId) =>
					({
						requestId,
						requests,
					}) satisfies MosaicDomainResidencyHydrateSocketRequest<
						Identity,
						Range
					>,
			)
		},
		propose(proposal) {
			return ask<MosaicDomainResidencyProposalResult<Identity>>(
				MOSAIC_DOMAIN_RESIDENCY_EVENTS.propose,
				(requestId) =>
					({
						proposal,
						requestId,
					}) satisfies MosaicDomainResidencyProposeSocketRequest<Identity>,
			)
		},
		async subscribe(requests, listener) {
			if (subscriptions.size >= maxSubscriptions) {
				throw new Error(`Residency socket subscription limit is reached.`)
			}
			const subscriptionId = nextId()
			subscriptions.set(subscriptionId, listener)
			try {
				await ask<void>(
					MOSAIC_DOMAIN_RESIDENCY_EVENTS.subscribe,
					(requestId) =>
						({
							requestId,
							requests,
							subscriptionId,
						}) satisfies MosaicDomainResidencySubscribeSocketRequest<
							Identity,
							Range
						>,
				)
			} catch (error) {
				subscriptions.delete(subscriptionId)
				throw error
			}
			let active = true
			return () => {
				if (!active) return
				active = false
				subscriptions.delete(subscriptionId)
				if (!disposed) {
					socket.emit(MOSAIC_DOMAIN_RESIDENCY_EVENTS.unsubscribe, {
						subscriptionId,
					} satisfies MosaicDomainResidencyUnsubscribeSocketRequest)
				}
			}
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			rejectAll(new Error(`Residency transport is disposed.`))
			subscriptions.clear()
			socket.off(MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrateResult, settle)
			socket.off(MOSAIC_DOMAIN_RESIDENCY_EVENTS.proposeResult, settle)
			socket.off(MOSAIC_DOMAIN_RESIDENCY_EVENTS.subscribeResult, settle)
			socket.off(MOSAIC_DOMAIN_RESIDENCY_EVENTS.accepted, onAccepted)
			socket.off(`disconnect`, onDisconnect)
		},
	}
}
