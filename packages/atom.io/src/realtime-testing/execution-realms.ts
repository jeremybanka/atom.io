export type RealtimeRealmKind = `browser` | `in-process` | `process` | `worker`

/** Per-client counters reported by execution-realm and load fixtures. */
export type RealtimeRealmMetrics = {
	readonly memoryBytes: number | null
	readonly peakPending: number
	readonly pending: number
	readonly received: number
	readonly sent: number
}

/** Common lifecycle and message boundary for every optional execution realm. */
export type RealtimeRealmBridge<ToRealm, FromRealm> = {
	close: () => Promise<void>
	metrics: () => RealtimeRealmMetrics
	send: (message: ToRealm) => Promise<void>
	subscribe: (listener: (message: FromRealm) => void) => () => void
}

export type RealtimeExecutionRealmClient<ToRealm, FromRealm> = {
	readonly bridge: RealtimeRealmBridge<ToRealm, FromRealm>
	dispose: () => Promise<void>
	readonly id: string
	readonly kind: RealtimeRealmKind
}

/** Factory shared by fast in-process, worker, process and browser fixtures. */
export interface RealtimeExecutionRealmAdapter<ToRealm, FromRealm> {
	readonly kind: RealtimeRealmKind
	create(id: string): Promise<RealtimeExecutionRealmClient<ToRealm, FromRealm>>
}

/**
 * Structural endpoint implemented by MessagePort, child-process IPC, or a thin
 * Playwright `page.exposeFunction`/`page.evaluate` bridge.
 */
export type RealtimeRealmEndpoint<ToRealm, FromRealm> = {
	close?: () => void | Promise<void>
	memoryUsage?: () => number | null | Promise<number | null>
	post: (message: ToRealm) => void | Promise<void>
	subscribe: (listener: (message: FromRealm) => void) => () => void
}

export type BridgedRealmLaunch<ToRealm, FromRealm> = (
	id: string,
) =>
	| RealtimeRealmEndpoint<ToRealm, FromRealm>
	| Promise<RealtimeRealmEndpoint<ToRealm, FromRealm>>

type MutableMetrics = {
	memoryBytes: number | null
	peakPending: number
	pending: number
	received: number
	sent: number
}

const snapshotMetrics = (metrics: MutableMetrics): RealtimeRealmMetrics => ({
	...metrics,
})

/** Adapt any structural message endpoint into the common execution-realm API. */
export function createBridgedExecutionRealmAdapter<ToRealm, FromRealm>(
	kind: Exclude<RealtimeRealmKind, `in-process`>,
	launch: BridgedRealmLaunch<ToRealm, FromRealm>,
): RealtimeExecutionRealmAdapter<ToRealm, FromRealm> {
	return {
		kind,
		create: async (id) => {
			if (id.length === 0) throw new Error(`Execution realm ID cannot be empty`)
			const endpoint = await launch(id)
			const listeners = new Set<(message: FromRealm) => void>()
			const metrics: MutableMetrics = {
				memoryBytes: null,
				peakPending: 0,
				pending: 0,
				received: 0,
				sent: 0,
			}
			let closed = false
			const unsubscribeEndpoint = endpoint.subscribe((message) => {
				if (closed) return
				metrics.received++
				for (const listener of [...listeners]) listener(message)
			})
			const close = async (): Promise<void> => {
				if (closed) return
				closed = true
				unsubscribeEndpoint()
				listeners.clear()
				await endpoint.close?.()
			}
			const bridge: RealtimeRealmBridge<ToRealm, FromRealm> = {
				close,
				metrics: () => snapshotMetrics(metrics),
				send: async (message) => {
					if (closed) throw new Error(`Execution realm ${id} is closed`)
					metrics.sent++
					metrics.pending++
					metrics.peakPending = Math.max(metrics.peakPending, metrics.pending)
					try {
						await endpoint.post(message)
						metrics.memoryBytes = (await endpoint.memoryUsage?.()) ?? null
					} finally {
						metrics.pending--
					}
				},
				subscribe: (listener) => {
					if (closed) throw new Error(`Execution realm ${id} is closed`)
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
			}
			return { bridge, dispose: close, id, kind }
		},
	}
}

export type InProcessRealmRuntime<ToRealm> = {
	dispose?: () => void | Promise<void>
	memoryUsage?: () => number | null
	receive: (message: ToRealm) => void | Promise<void>
}

export type InProcessRealmContext<FromRealm> = {
	emit: (message: FromRealm) => void
	id: string
}

/** Create the default fast realm adapter with no serialization or DOM cost. */
export function createInProcessExecutionRealmAdapter<ToRealm, FromRealm>(
	createRuntime: (
		context: InProcessRealmContext<FromRealm>,
	) => InProcessRealmRuntime<ToRealm>,
): RealtimeExecutionRealmAdapter<ToRealm, FromRealm> {
	return {
		kind: `in-process`,
		create: (id) => {
			const listeners = new Set<(message: FromRealm) => void>()
			const metrics: MutableMetrics = {
				memoryBytes: null,
				peakPending: 0,
				pending: 0,
				received: 0,
				sent: 0,
			}
			let closed = false
			const runtime = createRuntime({
				emit: (message) => {
					if (closed) return
					metrics.received++
					for (const listener of [...listeners]) listener(message)
				},
				id,
			})
			const close = async (): Promise<void> => {
				if (closed) return
				closed = true
				listeners.clear()
				await runtime.dispose?.()
			}
			const bridge: RealtimeRealmBridge<ToRealm, FromRealm> = {
				close,
				metrics: () => snapshotMetrics(metrics),
				send: async (message) => {
					if (closed) throw new Error(`Execution realm ${id} is closed`)
					metrics.sent++
					metrics.pending++
					metrics.peakPending = Math.max(metrics.peakPending, metrics.pending)
					try {
						await runtime.receive(message)
						metrics.memoryBytes = runtime.memoryUsage?.() ?? null
					} finally {
						metrics.pending--
					}
				},
				subscribe: (listener) => {
					if (closed) throw new Error(`Execution realm ${id} is closed`)
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
			}
			return Promise.resolve({ bridge, dispose: close, id, kind: `in-process` })
		},
	}
}

/** Worker-style alias preserving the common structural endpoint contract. */
export const createWorkerExecutionRealmAdapter = <ToRealm, FromRealm>(
	launch: BridgedRealmLaunch<ToRealm, FromRealm>,
): RealtimeExecutionRealmAdapter<ToRealm, FromRealm> =>
	createBridgedExecutionRealmAdapter(`worker`, launch)

/** Child-process IPC alias preserving the common structural endpoint contract. */
export const createProcessExecutionRealmAdapter = <ToRealm, FromRealm>(
	launch: BridgedRealmLaunch<ToRealm, FromRealm>,
): RealtimeExecutionRealmAdapter<ToRealm, FromRealm> =>
	createBridgedExecutionRealmAdapter(`process`, launch)

/**
 * Browser alias. Playwright remains optional: callers adapt a page to
 * {@link RealtimeRealmEndpoint} with `exposeFunction` and `evaluate`.
 */
export const createBrowserExecutionRealmAdapter = <ToRealm, FromRealm>(
	launch: BridgedRealmLaunch<ToRealm, FromRealm>,
): RealtimeExecutionRealmAdapter<ToRealm, FromRealm> =>
	createBridgedExecutionRealmAdapter(`browser`, launch)

export type RealtimeLoadClientMetrics = RealtimeRealmMetrics & {
	readonly convergenceMs: number
	readonly id: string
}

export type RealtimeLoadReport = {
	readonly clientCount: number
	readonly clients: readonly RealtimeLoadClientMetrics[]
	readonly convergenceMs: number
	readonly memoryBytes: number | null
}

export type RealtimeLoadFixtureOptions<ToRealm, FromRealm> = {
	adapter: RealtimeExecutionRealmAdapter<ToRealm, FromRealm>
	/** Defaults to 200. */
	clients?: number
	/** Exercise one client after all realms have started. */
	exercise?: (
		client: RealtimeExecutionRealmClient<ToRealm, FromRealm>,
		index: number,
	) => void | Promise<void>
	/** CI safety bound. Defaults to 1,000. */
	maxClients?: number
	/** Injectable monotonic timer. */
	now?: () => number
	/** Resolve only when application-specific convergence is established. */
	waitForConvergence: (
		clients: readonly RealtimeExecutionRealmClient<ToRealm, FromRealm>[],
	) => void | Promise<void>
	/** Optional per-client convergence probe used for individual timing. */
	waitForClientConvergence?: (
		client: RealtimeExecutionRealmClient<ToRealm, FromRealm>,
		index: number,
	) => void | Promise<void>
}

/** Run a bounded load fixture and report queue, memory, and convergence metrics. */
export async function runRealtimeLoadFixture<ToRealm, FromRealm>(
	options: RealtimeLoadFixtureOptions<ToRealm, FromRealm>,
): Promise<RealtimeLoadReport> {
	const count = options.clients ?? 200
	const maxClients = options.maxClients ?? 1_000
	if (!Number.isInteger(count) || count < 1 || count > maxClients) {
		throw new Error(`clients must be between 1 and maxClients (${maxClients})`)
	}
	const now = options.now ?? performance.now.bind(performance)
	const clients: RealtimeExecutionRealmClient<ToRealm, FromRealm>[] = []
	try {
		for (let index = 0; index < count; index++) {
			clients.push(await options.adapter.create(`client-${index}`))
		}
		const started = now()
		const convergenceTimes: number[] = []
		for (const [index, client] of clients.entries()) {
			await options.exercise?.(client, index)
			await options.waitForClientConvergence?.(client, index)
			convergenceTimes.push(Math.max(0, now() - started))
		}
		await options.waitForConvergence(clients)
		const convergenceMs = Math.max(0, now() - started)
		const clientMetrics = clients.map((client, index) => ({
			...client.bridge.metrics(),
			convergenceMs:
				options.waitForClientConvergence === undefined
					? convergenceMs
					: convergenceTimes[index],
			id: client.id,
		}))
		const measured = clientMetrics
			.map(({ memoryBytes }) => memoryBytes)
			.filter((value): value is number => value !== null)
		return {
			clientCount: count,
			clients: clientMetrics,
			convergenceMs,
			memoryBytes:
				measured.length === clientMetrics.length
					? measured.reduce((total, value) => total + value, 0)
					: null,
		}
	} finally {
		await Promise.all(clients.map((client) => client.dispose()))
	}
}
