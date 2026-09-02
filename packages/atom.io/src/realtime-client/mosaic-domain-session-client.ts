import type { MosaicAcceptedDomainBatchEnvelope } from "atom.io/realtime"

import type { MosaicDomainHistoryClient } from "./mosaic-domain-history-client.ts"
import type { MosaicDomainPresenceClient } from "./mosaic-domain-presence-client.ts"
import type { MosaicDomainResidencyClient } from "./mosaic-domain-residency-client.ts"

export type MosaicDomainSessionSocket = {
	readonly connected: boolean
	off(event: `connect` | `disconnect`, listener: () => void): void
	on(event: `connect` | `disconnect`, listener: () => void): void
	once(event: `connect`, listener: () => void): void
}

export type MosaicDomainSessionClientState = {
	readonly connection: `connecting` | `live` | `offline` | `recovering`
	readonly pending: number
	readonly reason: string | null
}

export type MosaicDomainSessionClient<Command> = Disposable & {
	history(mode: `redo` | `undo`): Promise<boolean>
	readonly sequence: number
	state(): MosaicDomainSessionClientState
	submit(create: (sequence: number) => Command): Promise<void>
	subscribe(
		listener: (state: MosaicDomainSessionClientState) => void,
	): () => void
	synchronize(): Promise<void>
}

/**
 * Coordinate one browser session's residency, presence, history, reconnect,
 * and accepted-to-resident command settlement lifecycle.
 */
export async function createMosaicDomainSessionClient<Command>(options: {
	readonly history: Pick<
		MosaicDomainHistoryClient,
		`refresh` | `request` | `start` | `state` | `subscribe`
	>
	readonly initialSequence?: number
	readonly presence: Pick<
		MosaicDomainPresenceClient,
		`refresh` | `republish` | `start` | `subscribe`
	>
	readonly residency: Pick<
		MosaicDomainResidencyClient,
		`reconnect` | `state` | `subscribeState`
	>
	readonly send: (command: Command) => Promise<MosaicAcceptedDomainBatchEnvelope>
	readonly socket: MosaicDomainSessionSocket
	readonly settlementTimeoutMs?: number
}): Promise<MosaicDomainSessionClient<Command>> {
	const settlementTimeoutMs = options.settlementTimeoutMs ?? 10_000
	const initialSequence = options.initialSequence ?? 0
	if (
		!Number.isSafeInteger(settlementTimeoutMs) ||
		settlementTimeoutMs < 1 ||
		!Number.isSafeInteger(initialSequence) ||
		initialSequence < 0
	) {
		throw new Error(
			`Domain session limits must be safe integers with a positive timeout.`,
		)
	}
	let sequence = initialSequence
	let pending = 0
	let disposed = false
	let synchronizing = false
	let synchronization = Promise.resolve()
	let commandTail = Promise.resolve()
	const waiters = new Set<() => void>()
	const listeners = new Set<(state: MosaicDomainSessionClientState) => void>()
	const snapshot = (): MosaicDomainSessionClientState => ({
		connection:
			options.history.state.status === `rejected`
				? `recovering`
				: !options.socket.connected ||
					  options.history.state.status === `offline` ||
					  options.residency.state.connectivity === `offline`
					? `offline`
					: synchronizing
						? `connecting`
						: `live`,
		pending: pending + options.history.state.pending,
		reason:
			options.residency.state.problem?.reason ??
			options.history.state.problem?.reason ??
			null,
	})
	const notify = (): void => {
		const state = snapshot()
		for (const listener of listeners) listener(state)
	}
	const synchronize = async (): Promise<void> => {
		if (disposed) throw new Error(`The Domain session is disposed.`)
		await options.residency.reconnect()
		try {
			await options.presence.start()
		} catch {
			// Presence is advisory and retains the latest validated local intent.
		}
		await options.presence.refresh()
		await options.presence.republish().catch(() => undefined)
		if (options.history.state.snapshot === null) await options.history.start()
		else await options.history.refresh()
		notify()
	}
	const waitForConnection = (): Promise<void> =>
		new Promise((resolve, reject) => {
			let settled = false
			const cleanup = (): void => {
				options.socket.off(`connect`, onConnect)
				waiters.delete(onDispose)
			}
			const onConnect = (): void => {
				if (settled) return
				settled = true
				cleanup()
				resolve()
			}
			const onDispose = (): void => {
				if (settled) return
				settled = true
				cleanup()
				reject(new Error(`The Domain session is disposed.`))
			}
			options.socket.once(`connect`, onConnect)
			waiters.add(onDispose)
			if (options.socket.connected) onConnect()
			else if (disposed) onDispose()
		})
	const waitForRevision = (revision: number): Promise<void> =>
		new Promise((resolve, reject) => {
			let settled = false
			let stop = (): void => undefined
			let timer: ReturnType<typeof setTimeout>
			const cleanup = (): void => {
				clearTimeout(timer)
				stop()
				waiters.delete(onDispose)
			}
			const onDispose = (): void => {
				if (settled) return
				settled = true
				cleanup()
				reject(new Error(`The Domain session is disposed.`))
			}
			timer = setTimeout(() => {
				if (settled) return
				settled = true
				cleanup()
				reject(
					new Error(
						`The resident projection did not settle revision ${revision}.`,
					),
				)
			}, settlementTimeoutMs)
			;(timer as { unref?: () => void }).unref?.()
			const unsubscribe = options.residency.subscribeState((state) => {
				if (settled || state.headRevision < revision) return
				settled = true
				cleanup()
				resolve()
			})
			stop = unsubscribe
			waiters.add(onDispose)
			if (settled) stop()
			else if (disposed) onDispose()
		})
	const send = async (command: Command): Promise<void> => {
		for (;;) {
			if (disposed) throw new Error(`The Domain session is disposed.`)
			if (!options.socket.connected) await waitForConnection()
			try {
				await synchronization
				if (disposed) throw new Error(`The Domain session is disposed.`)
				if (!options.socket.connected) continue
				const accepted = await options.send(command)
				await waitForRevision(accepted.revision)
				return
			} catch (error) {
				if (
					!options.socket.connected ||
					(error instanceof Error &&
						(error.message === `offline` || error.name === `AbortError`))
				) {
					continue
				}
				throw error
			}
		}
	}
	const stopResidency = options.residency.subscribeState(notify)
	const stopPresence = options.presence.subscribe(notify)
	const stopHistory = options.history.subscribe(notify)
	const reconnect = (): void => {
		synchronizing = true
		notify()
		const work = synchronize()
		synchronization = work
		void work.catch(notify).finally(() => {
			if (synchronization !== work) return
			synchronizing = false
			notify()
		})
	}
	const disconnect = (): void => {
		notify()
	}
	options.socket.on(`connect`, reconnect)
	options.socket.on(`disconnect`, disconnect)
	if (options.socket.connected) {
		synchronizing = true
		const work = synchronize()
		synchronization = work
		await work.catch(() => undefined)
		if (synchronization === work) synchronizing = false
	}
	return {
		async history(mode) {
			await options.history.refresh()
			const current = options.history.state.snapshot
			if (current === null) return false
			if (
				mode === `undo` ? !current.horizon.canUndo : !current.horizon.canRedo
			) {
				return false
			}
			const result = await options.history.request(mode)
			if (result.status === `rejected`) throw new Error(result.reason)
			return result.status === `accepted`
		},
		get sequence() {
			return sequence
		},
		state: snapshot,
		submit(create) {
			pending++
			notify()
			let command: Command
			try {
				command = create(++sequence)
			} catch (error) {
				pending--
				notify()
				return Promise.reject(error)
			}
			const work = commandTail.then(async () => {
				await send(command)
				await options.history.refresh()
			})
			commandTail = work.then(
				() => undefined,
				() => undefined,
			)
			return work.finally(() => {
				pending--
				notify()
			})
		},
		subscribe(listener) {
			listeners.add(listener)
			listener(snapshot())
			return () => listeners.delete(listener)
		},
		synchronize,
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			for (const cancel of waiters) cancel()
			waiters.clear()
			options.socket.off(`connect`, reconnect)
			options.socket.off(`disconnect`, disconnect)
			stopResidency()
			stopPresence()
			stopHistory()
			listeners.clear()
		},
	}
}
