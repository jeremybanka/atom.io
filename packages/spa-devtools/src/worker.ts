import type { ReadonlyPureSelectorToken, RegularAtomToken, Silo } from "atom.io"
import { isReservedIntrospectionKey } from "atom.io/internal"

import type {
	PanelMessage,
	WorkerDevtoolsValue,
	WorkerMessage,
} from "./worker-protocol.ts"
import { isWorkerDevtoolsValue } from "./worker-protocol.ts"

export type { WorkerDevtoolsValue } from "./worker-protocol.ts"

type ValidateEdit = (value: WorkerDevtoolsValue) => boolean
export type WorkerDevtoolsState =
	| { token: RegularAtomToken<WorkerDevtoolsValue>; validateEdit?: ValidateEdit }
	| {
			token: ReadonlyPureSelectorToken<WorkerDevtoolsValue>
			validateEdit?: never
	  }

/** Expose explicitly selected, standalone state from a worker Silo. Owns the supplied port. */
export function exposeDevtoolsStore(
	port: MessagePort,
	silo: Silo,
	states: readonly WorkerDevtoolsState[],
): () => void {
	const entries = new Map(
		states.map(({ token, validateEdit }) => {
			const definitions =
				token.type === `atom` ? silo.store.atoms : silo.store.readonlySelectors
			const definition = definitions.get(token.key)
			if (!definition || token.family || isReservedIntrospectionKey(token.key))
				throw new Error(
					`Devtools requires a standalone state in the supplied Silo: ` +
						token.key,
				)
			const entry = {
				token,
				validateEdit,
				revision: 0,
				isPresent: () => definitions.get(token.key) === definition,
			}
			return [token.key, entry] as const
		}),
	)
	if (entries.size !== states.length)
		throw new Error(`Duplicate worker devtools state keys`)

	const subscriptions: (() => void)[] = []
	let closed = false
	let scheduled = false
	const send = (message: WorkerMessage) => {
		port.postMessage(message)
	}
	const publish = () => {
		if (closed) return
		send({
			type: `snapshot`,
			states: Array.from(
				entries.values(),
				({ token, validateEdit, revision, isPresent }) => {
					const kind = token.type === `atom` ? `atom` : `selector`
					const base = {
						key: token.key,
						revision,
						kind,
						editable: false,
					} as const
					if (!isPresent())
						return { ...base, error: `State is no longer available` }
					try {
						const value = silo.getState(token)
						if (isWorkerDevtoolsValue(value))
							return {
								...base,
								value,
								editable: Boolean(validateEdit) && value !== null,
							}
						return { ...base, error: `Expected a synchronous JSON primitive` }
					} catch {
						return { ...base, error: `Could not read worker state` }
					}
				},
			),
		})
	}
	const scheduleSnapshot = () => {
		if (scheduled) return
		scheduled = true
		queueMicrotask(() => {
			scheduled = false
			publish()
		})
	}
	const dispose = () => {
		if (closed) return
		closed = true
		port.removeEventListener(`message`, receive)
		port.removeEventListener(`messageerror`, dispose)
		for (const unsubscribe of subscriptions) unsubscribe()
		send({ type: `close` })
		port.close()
	}
	function receive({ data }: MessageEvent<PanelMessage>): void {
		if (data?.type === `close`) {
			dispose()
			return
		}
		if (data?.type !== `edit`) return
		const entry = entries.get(data.key)
		try {
			if (
				entry?.token.type !== `atom` ||
				!entry.validateEdit ||
				!entry.isPresent()
			)
				throw new Error(`Worker state is readonly or unavailable`)
			if (data.revision !== entry.revision)
				throw new Error(
					`Worker state changed while you were editing. Try again with the current value.`,
				)
			const current = silo.getState(entry.token)
			if (
				!isWorkerDevtoolsValue(current) ||
				current === null ||
				!isWorkerDevtoolsValue(data.value) ||
				typeof current !== typeof data.value ||
				!entry.validateEdit(data.value)
			)
				throw new Error(`Worker rejected this value`)
			silo.setState(entry.token, data.value)
		} catch (error) {
			send({
				type: `edit-error`,
				message: error instanceof Error ? error.message : String(error),
			})
		}
		scheduleSnapshot()
	}
	try {
		for (const entry of entries.values()) {
			subscriptions.push(
				silo.subscribe(entry.token, () => {
					entry.revision++
					scheduleSnapshot()
				}),
			)
		}
		port.addEventListener(`message`, receive)
		port.addEventListener(`messageerror`, dispose)
		port.start()
		publish()
	} catch (error) {
		dispose()
		throw error
	}
	return dispose
}
