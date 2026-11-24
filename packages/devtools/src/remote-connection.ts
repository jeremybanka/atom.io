import { type RegularAtomToken, Silo } from "atom.io"
import type { RootStore } from "atom.io/internal"

import type { EcologySnapshot } from "./ecology.ts"
import {
	closeDevtoolsTransport,
	type DevtoolsPanelTransport,
} from "./transport.ts"
import { createRemoteProjection } from "./remote-projection.ts"
import type {
	PanelMessage,
	RemoteCachedValue,
	RemoteGenerate,
	RemoteMessage,
	RemoteRelease,
	RemoteState,
} from "./remote-protocol.ts"

import { REMOTE_PROTOCOL_VERSION } from "./remote-protocol.ts"
import type { StoreViews } from "./store.ts"

export interface RemotePanelConnection {
	views: StoreViews
	canGenerate(): boolean
	error: RegularAtomToken<string>
	ready: RegularAtomToken<boolean>
	canControl(): boolean
	revision(key: string): number | undefined
	edit(key: string, value: unknown, revision?: number): void
	cache(key: string): RegularAtomToken<RemoteCachedValue> | undefined
	generate(key: string, batch?: boolean): void
	watchSelector(key: string): {
		generate(batch?: boolean): void
		dispose(): void
	}
	disposeState(key: string): void
	timeline(key: string, action: `undo` | `redo`): void
	ecology(): EcologySnapshot | undefined
	subscribeEcology(listener: () => void): () => void
}

export function connectRemoteStore(transport: DevtoolsPanelTransport): {
	store: RootStore
	worker: RemotePanelConnection
	close(): void
} {
	const silo = new Silo({
		name: `Remote devtools`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const errorAtom = silo.atom<string>({
		// eslint-disable-next-line atom.io/naming-convention -- keep the panel's status out of the atom index
		key: `🔍 Remote devtools error`,
		default: ``,
	})
	const readyAtom = silo.atom<boolean>({
		// eslint-disable-next-line atom.io/naming-convention -- keep the panel's status out of the atom index
		key: `🔍 Remote devtools ready`,
		default: false,
	})
	const projection = createRemoteProjection(silo)
	let closed = false
	let control = false
	let mode: `store` | `snapshot` | undefined
	let nextSequence = 1
	let nextWatch = 0
	let stateRequestScheduled = false
	const generations = new Set<RemoteGenerate>()
	const releases: RemoteRelease[] = []
	const command = (message: PanelMessage) => {
		if (closed) throw new Error(`Remote devtools disconnected`)
		transport.send(message)
	}
	function scheduleStateRequests(): void {
		if (stateRequestScheduled) return
		stateRequestScheduled = true
		queueMicrotask(() => {
			stateRequestScheduled = false
			const generate = [...generations]
			generations.clear()
			const release = releases.splice(0)
			if (closed || (generate.length === 0 && release.length === 0)) return
			try {
				command({ type: `state-requests`, generate, release })
			} catch {
				connectionLost()
			}
		})
	}
	function requestGeneration(request: RemoteGenerate, batch = false): void {
		if (!batch) {
			command({ ...request, type: `generate` })
			return
		}
		generations.add(request)
		scheduleStateRequests()
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
	function invalidate(message: string): void {
		close()
		control = false
		silo.setState(errorAtom, message)
		silo.setState(readyAtom, false)
	}
	function desynced(): void {
		invalidate(`Remote devtools is out of sync. Reconnect to reload the store.`)
	}
	function applyStates(updated: RemoteState[]): void {
		projection.updateStates(
			updated.map((state) => ({
				token: {
					key: state.key,
					type: state.kind === `atom` ? `atom` : `readonly_pure_selector`,
				},
				cache: {
					status: `value`,
					value: `value` in state ? state.value : new Error(state.error),
				},
				revision: state.revision,
				editable: state.editable,
			})),
		)
	}
	function receive(data: RemoteMessage): void {
		if (closed) return
		if (data?.type === `close`) {
			connectionLost(false)
		} else if (data?.type === `edit-error`) {
			silo.setState(errorAtom, data.message)
		} else if (data?.type === `store` || data?.type === `snapshot`) {
			if (mode) {
				desynced()
				return
			}
			if (data.version !== REMOTE_PROTOCOL_VERSION) {
				invalidate(
					`Unsupported remote devtools protocol version. Update both endpoints to the same version.`,
				)
				return
			}
			mode = data.type
			if (data.type === `store`) {
				control = data.snapshot.control
				projection.apply(data.snapshot)
			} else {
				control = data.control
				applyStates(data.states)
			}
			silo.setState(readyAtom, true)
		} else if (
			data?.type === `store-update` ||
			data?.type === `snapshot-update`
		) {
			if (data.type !== `${mode}-update` || data.sequence !== nextSequence) {
				desynced()
				return
			}
			nextSequence++
			if (data.type === `store-update`) projection.update(data.update)
			else applyStates(data.states)
		}
	}
	const worker: RemotePanelConnection = {
		views: projection.views,
		canGenerate: () => control && mode === `store`,
		error: errorAtom,
		ready: readyAtom,
		canControl: () => control,
		revision: projection.revision,
		edit(key, value, revision = worker.revision(key)) {
			command({ type: `edit`, key, value, revision })
		},
		cache: projection.cache,
		generate(key, batch) {
			requestGeneration({ key }, batch)
		},
		watchSelector(key) {
			const watch = nextWatch++
			const request = { key, watch }
			let started = false
			return {
				generate(batch) {
					if (!batch) generations.delete(request)
					requestGeneration(request, batch)
					started = true
				},
				dispose() {
					if (closed || !started) return
					started = false
					if (generations.delete(request)) return
					releases.push(request)
					scheduleStateRequests()
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
