import { type RegularAtomToken, Silo } from "atom.io"
import type { RootStore } from "atom.io/internal"

import type { EcologySnapshot } from "./ecology.ts"
import {
	closeDevtoolsTransport,
	type DevtoolsPanelTransport,
} from "./transport.ts"
import { createWorkerProjection } from "./worker-projection.ts"
import type {
	PanelMessage,
	WorkerCachedValue,
	WorkerMessage,
} from "./worker-protocol.ts"

export interface WorkerPanelConnection {
	error: RegularAtomToken<string>
	ready: RegularAtomToken<boolean>
	canControl(): boolean
	revision(key: string): number | undefined
	edit(key: string, value: unknown, revision?: number): void
	cache(key: string): RegularAtomToken<WorkerCachedValue> | undefined
	generate(key: string): void
	watchSelector(key: string): { generate(): void; dispose(): void }
	disposeState(key: string): void
	timeline(key: string, action: `undo` | `redo`): void
	ecology(): EcologySnapshot | undefined
	subscribeEcology(listener: () => void): () => void
}

export function connectRemoteStore(transport: DevtoolsPanelTransport): {
	store: RootStore
	worker: WorkerPanelConnection
	close(): void
} {
	const silo = new Silo({
		name: `Worker devtools`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const errorAtom = silo.atom<string>({
		// eslint-disable-next-line atom.io/naming-convention -- keep the panel's status out of the atom index
		key: `🔍 Worker devtools error`,
		default: ``,
	})
	const readyAtom = silo.atom<boolean>({
		// eslint-disable-next-line atom.io/naming-convention -- keep the panel's status out of the atom index
		key: `🔍 Worker devtools ready`,
		default: false,
	})
	const states = new Map<
		string,
		{ value: RegularAtomToken<unknown>; revision: number | undefined }
	>()
	const projection = createWorkerProjection(silo)
	let closed = false
	let control = false
	let nextWatch = 0
	const command = (message: PanelMessage) => {
		if (closed) throw new Error(`Remote devtools disconnected`)
		transport.send(message)
	}
	function close(notify = true): void {
		if (closed) return
		closed = true
		closeDevtoolsTransport(transport, notify)
	}
	function connectionLost(notify = true): void {
		close(notify)
		silo.setState(errorAtom, `Remote devtools disconnected`)
	}
	function receive(data: WorkerMessage): void {
		if (closed) return
		if (data?.type === `close`) {
			connectionLost(false)
		} else if (data?.type === `edit-error`) {
			silo.setState(errorAtom, data.message)
		} else if (data?.type === `store`) {
			control = data.snapshot.control
			projection.apply(data.snapshot)
			silo.setState(readyAtom, true)
		} else if (data?.type === `snapshot`) {
			control = data.control
			for (const state of data.states) {
				const value = `value` in state ? state.value : new Error(state.error)
				let entry = states.get(state.key)
				if (!entry) {
					const backingAtom = silo.atom<unknown>({
						key:
							// eslint-disable-next-line atom.io/naming-convention -- preserve remote keys and hide selector backing atoms
							state.kind === `atom`
								? state.key
								: `🔍 Worker selector: ` + state.key,
						default: () => value,
					})
					entry = { value: backingAtom, revision: undefined }
					states.set(state.key, entry)
					if (state.kind === `selector`)
						silo.selector<unknown>({
							key: state.key,
							get: ({ get }) => get(backingAtom),
						})
				}
				entry.revision = state.editable ? state.revision : undefined
				silo.setState(entry.value, () => value)
			}
			silo.setState(readyAtom, true)
		}
	}
	const worker: WorkerPanelConnection = {
		error: errorAtom,
		ready: readyAtom,
		canControl: () => control,
		revision: (key) => projection.revision(key) ?? states.get(key)?.revision,
		edit(key, value, revision = worker.revision(key)) {
			command({ type: `edit`, key, value, revision })
		},
		cache: projection.cache,
		generate(key) {
			command({ type: `generate`, key })
		},
		watchSelector(key) {
			const watch = nextWatch++
			let started = false
			return {
				generate() {
					command({ type: `generate`, key, watch })
					started = true
				},
				dispose() {
					if (closed || !started) return
					started = false
					try {
						command({ type: `release`, key, watch })
					} catch {
						connectionLost()
					}
				},
			}
		},
		disposeState(key) {
			command({ type: `dispose`, key })
		},
		timeline(key, action) {
			command({
				type: `timeline`,
				key,
				action,
				revision: projection.timelineRevision(key),
			})
		},
		ecology: projection.ecology,
		subscribeEcology: projection.subscribeEcology,
	}
	try {
		transport.listen(receive, connectionLost)
	} catch (error) {
		close(false)
		throw error
	}
	return { store: silo.store, worker, close }
}
