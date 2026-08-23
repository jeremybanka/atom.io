import {
	MOSAIC_DOMAIN_RESIDENCY_EVENTS,
	type MosaicDomainResidencyAcceptedSlice,
} from "atom.io/realtime"
import { createMosaicDomainResidencySocketTransport } from "atom.io/realtime-client"
import { bindMosaicDomainResidencyServerSocket } from "atom.io/realtime-server"
import { vi } from "vitest"

type Listener = (payload: any) => void

function socketPair() {
	const clientListeners = new Map<string, Set<Listener>>()
	const serverListeners = new Map<string, Set<Listener>>()
	const endpoint = (
		own: Map<string, Set<Listener>>,
		peer: Map<string, Set<Listener>>,
	) => ({
		emit(event: string, payload: any) {
			for (const listener of peer.get(event) ?? []) listener(payload)
		},
		off(event: string, listener?: Listener) {
			if (listener === undefined) own.delete(event)
			else own.get(event)?.delete(listener)
		},
		on(event: string, listener: Listener) {
			const listeners = own.get(event) ?? new Set()
			listeners.add(listener)
			own.set(event, listeners)
		},
	})
	return {
		client: endpoint(clientListeners, serverListeners),
		disconnect() {
			for (const listener of clientListeners.get(`disconnect`) ?? [])
				listener(undefined)
			for (const listener of serverListeners.get(`disconnect`) ?? [])
				listener(undefined)
		},
		server: endpoint(serverListeners, clientListeners),
	}
}

const accepted = (revision: number): MosaicDomainResidencyAcceptedSlice => ({
	invalidations: [],
	metadata: {
		actor: `ada`,
		affectedMemberCount: 0,
		batchId: `batch-${revision}`,
		dependencyCount: 0,
		group: null,
		operationCount: 0,
		revision,
		revisionToken: `revision-${revision}`,
		session: `tab`,
	},
})

describe(`Mosaic Domain residency socket transport`, () => {
	test(`round-trips bounded requests and cleans subscriptions`, async () => {
		const pair = socketPair()
		let publish:
			| ((event: MosaicDomainResidencyAcceptedSlice) => void)
			| undefined
		const stop = vi.fn()
		const connection = {
			dispose: vi.fn(),
			hydrate: vi.fn(() =>
				Promise.resolve({
					headRevision: 3,
					members: [],
					resolutions: [],
				}),
			),
			propose: vi.fn(() =>
				Promise.resolve({
					rejection: { code: `rejected`, reason: `no` },
					status: `rejected` as const,
				}),
			),
			subscribe: vi.fn((_requests, listener) => {
				publish = listener
				return stop
			}),
		}
		const cleanup = bindMosaicDomainResidencyServerSocket(
			connection as never,
			pair.server,
		)
		const transport = createMosaicDomainResidencySocketTransport(pair.client, {
			idSource: (() => {
				let id = 0
				return () => `request-${++id}`
			})(),
		})

		await expect(transport.hydrate([])).resolves.toMatchObject({
			headRevision: 3,
		})
		await expect(transport.propose({} as never)).resolves.toMatchObject({
			status: `rejected`,
		})
		const listener = vi.fn()
		const unsubscribe = await transport.subscribe([], listener)
		publish?.(accepted(4))
		expect(listener).toHaveBeenCalledWith(accepted(4))
		unsubscribe()
		expect(stop).toHaveBeenCalledOnce()
		publish?.(accepted(5))
		expect(listener).toHaveBeenCalledTimes(1)

		transport[Symbol.dispose]()
		cleanup()
		expect(connection.dispose).toHaveBeenCalledOnce()
		await expect(transport.hydrate([])).rejects.toThrow(`disposed`)
	})

	test(`fails closed on malformed, throwing, disconnected, and timed-out work`, async () => {
		for (const options of [
			{ maxPendingRequests: 0 },
			{ maxSubscriptions: 0 },
			{ requestTimeoutMs: 0 },
		]) {
			expect(() =>
				createMosaicDomainResidencySocketTransport(socketPair().client, options),
			).toThrow(`positive integers`)
		}

		const malformed = socketPair()
		malformed.server.on(MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrate, (request) => {
			malformed.server.emit(MOSAIC_DOMAIN_RESIDENCY_EVENTS.hydrateResult, {
				ok: `yes`,
				requestId: request.requestId,
			})
		})
		const malformedTransport = createMosaicDomainResidencySocketTransport(
			malformed.client,
		)
		await expect(malformedTransport.hydrate([])).rejects.toThrow(
			`response is invalid`,
		)

		const disconnected = socketPair()
		const disconnectedTransport = createMosaicDomainResidencySocketTransport(
			disconnected.client,
		)
		const pending = disconnectedTransport.hydrate([])
		disconnected.disconnect()
		await expect(pending).rejects.toThrow(`disconnected`)

		const timed = createMosaicDomainResidencySocketTransport(
			socketPair().client,
			{
				requestTimeoutMs: 5,
			},
		)
		await expect(timed.hydrate([])).rejects.toThrow(`timed out`)

		const throwing = socketPair()
		throwing.client.emit = () => {
			throw new Error(`emit failed`)
		}
		const throwingTransport = createMosaicDomainResidencySocketTransport(
			throwing.client,
		)
		await expect(throwingTransport.hydrate([])).rejects.toThrow(`emit failed`)
	})

	test(`releases a subscription that resolves after server disposal`, async () => {
		const pair = socketPair()
		let resolve!: (stop: () => void) => void
		const delayed = new Promise<() => void>((settle) => {
			resolve = settle
		})
		const released = vi.fn()
		const cleanup = bindMosaicDomainResidencyServerSocket(
			{
				dispose: vi.fn(),
				hydrate: vi.fn(),
				propose: vi.fn(),
				subscribe: () => delayed,
			},
			pair.server,
			undefined,
			{ maxSubscriptions: 1 },
		)
		const transport = createMosaicDomainResidencySocketTransport(pair.client, {
			requestTimeoutMs: 5,
		})
		const subscribing = transport.subscribe([], vi.fn())
		await expect(transport.subscribe([], vi.fn())).rejects.toThrow(
			`subscription limit`,
		)
		cleanup()
		resolve(released)
		await expect(subscribing).rejects.toThrow(`timed out`)
		expect(released).toHaveBeenCalledOnce()
		expect(() =>
			bindMosaicDomainResidencyServerSocket(
				{} as never,
				pair.server,
				undefined,
				{ maxSubscriptions: 0 },
			),
		).toThrow(`positive integers`)
	})
})
