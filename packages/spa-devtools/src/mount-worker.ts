import { type RegularAtomToken, Silo } from "atom.io"
import type { RootStore } from "atom.io/internal"

import type { EcologySnapshot } from "./ecology.ts"
import { createWorkerProjection } from "./worker-projection.ts"
import type {
	PanelMessage,
	WorkerCachedValue,
	WorkerMessage,
} from "./worker-protocol.ts"

export interface WorkerPanelConnection {
	error: RegularAtomToken<string>
	revision(key: string): number | undefined
	edit(key: string, value: unknown, revision?: number): void
	cache(key: string): RegularAtomToken<WorkerCachedValue> | undefined
	generate(key: string): void
	disposeState(key: string): void
	timeline(
		key: string,
		action: `undo` | `redo`,
		at: number,
		length: number,
	): void
	ecology(): EcologySnapshot | undefined
	subscribeEcology(listener: () => void): () => void
}

export function connectWorker(port: MessagePort): {
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
	const states = new Map<
		string,
		{ value: RegularAtomToken<unknown>; revision: number | undefined }
	>()
	const projection = createWorkerProjection(silo)
	let closed = false
	const send = (message: PanelMessage) => {
		port.postMessage(message)
	}
	const command = (message: PanelMessage) => {
		if (closed) throw new Error(`Worker devtools disconnected`)
		send(message)
	}
	function close(): void {
		if (closed) return
		closed = true
		port.removeEventListener(`message`, receive)
		port.removeEventListener(`messageerror`, connectionLost)
		send({ type: `close` })
		port.close()
	}
	function connectionLost(): void {
		close()
		silo.setState(errorAtom, `Worker devtools disconnected`)
	}
	function receive({ data }: MessageEvent<WorkerMessage>): void {
		if (data?.type === `close`) {
			connectionLost()
		} else if (data?.type === `edit-error`) {
			silo.setState(errorAtom, data.message)
		} else if (data?.type === `store`) {
			projection.apply(data.snapshot)
		} else if (data?.type === `snapshot`) {
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
		}
	}
	const worker: WorkerPanelConnection = {
		error: errorAtom,
		revision: (key) => projection.revision(key) ?? states.get(key)?.revision,
		edit(key, value, revision = worker.revision(key)) {
			command({ type: `edit`, key, value, revision })
		},
		cache: projection.cache,
		generate(key) {
			command({ type: `generate`, key })
		},
		disposeState(key) {
			command({ type: `dispose`, key })
		},
		timeline(key, action, at, length) {
			command({ type: `timeline`, key, action, at, length })
		},
		ecology: projection.ecology,
		subscribeEcology: projection.subscribeEcology,
	}
	try {
		port.addEventListener(`message`, receive)
		port.addEventListener(`messageerror`, connectionLost)
		port.start()
	} catch (error) {
		close()
		throw error
	}
	return { store: silo.store, worker, close }
}
