import { type RegularAtomToken, Silo } from "atom.io"

import { type AtomIODevtoolsHandle, mountPanel } from "./mount.ts"
import type { PanelMessage, WorkerMessage } from "./worker-protocol.ts"

export interface WorkerPanelConnection {
	error: RegularAtomToken<string>
	revision(key: string): number | undefined
	edit(key: string, value: unknown, revision?: number): void
}

/** Mount the shared panel for a port connected to exposeDevtoolsStore. Owns the supplied port. */
export function mountWorkerAtomIODevtools(
	host: Element,
	port: MessagePort,
	options: { hideByDefault?: boolean } = {},
): AtomIODevtoolsHandle {
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
	let closed = false
	const send = (message: PanelMessage) => {
		port.postMessage(message)
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
		revision: (key) => states.get(key)?.revision,
		edit(key, value, revision = worker.revision(key)) {
			if (closed) throw new Error(`Worker devtools disconnected`)
			send({ type: `edit`, key, value, revision })
		},
	}
	let panel: AtomIODevtoolsHandle
	try {
		port.addEventListener(`message`, receive)
		port.addEventListener(`messageerror`, connectionLost)
		port.start()
		panel = mountPanel(host, silo.store, options.hideByDefault ?? false, worker)
	} catch (error) {
		close()
		throw error
	}
	return {
		dispose() {
			try {
				panel.dispose()
			} finally {
				close()
			}
		},
	}
}
