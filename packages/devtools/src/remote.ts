import type { ReadonlyPureSelectorToken, RegularAtomToken, Silo } from "atom.io"
import { isReservedIntrospectionKey } from "atom.io/internal"
import { observeStore, peekState } from "atom.io/introspection"

import {
	batchDevtoolsSnapshots,
	closeDevtoolsTransport,
	type DevtoolsStoreTransport,
	reportDevtoolsError,
} from "./transport.ts"
import type { PanelMessage, WorkerDevtoolsValue } from "./worker-protocol.ts"
import { isWorkerDevtoolsValue } from "./worker-protocol.ts"
import { exposeWholeStore } from "./worker-store.ts"

export type {
	DevtoolsPanelTransport,
	DevtoolsStoreTransport,
	DevtoolsTransport,
} from "./transport.ts"
export type {
	PanelMessage as DevtoolsPanelMessage,
	WorkerDevtoolsValue as DevtoolsPrimitive,
	WorkerMessage as DevtoolsStoreMessage,
} from "./worker-protocol.ts"

type ValidateEdit = (value: WorkerDevtoolsValue) => boolean
export type DevtoolsState =
	| { token: RegularAtomToken<WorkerDevtoolsValue>; validateEdit?: ValidateEdit }
	| {
			token: ReadonlyPureSelectorToken<WorkerDevtoolsValue>
			validateEdit?: never
	  }

export interface DevtoolsExposureOptions {
	/** Defaults to off. Inspect grants access to cached state and history. */
	access?: `off` | `inspect` | `control`
	/** Explicitly allow this exact access mode in production. */
	productionAccess?: `inspect` | `control`
	/** Limit exposure to these standalone primitive atoms and selectors. */
	states?: readonly DevtoolsState[]
}

/** Own a transport to one Silo. A disabled exposure closes it without sending store data. */
export function exposeDevtoolsStore(
	transport: DevtoolsStoreTransport,
	silo: Silo,
	options: DevtoolsExposureOptions = {},
): () => void {
	const access = options.access
	if (
		(access !== `inspect` && access !== `control`) ||
		((silo.store.config.isProduction ||
			globalThis.process?.env?.[`NODE_ENV`] === `production`) &&
			options.productionAccess !== access)
	) {
		closeDevtoolsTransport(transport, true)
		return () => {}
	}
	const control = access === `control`
	const allowlist = options.states
	if (!allowlist) return exposeWholeStore(transport, silo, control)
	const entries = new Map(
		allowlist.map(({ token, validateEdit }) => {
			const definitions =
				token.type === `atom` ? silo.store.atoms : silo.store.readonlySelectors
			const definition = definitions.get(token.key)
			if (!definition || token.family || isReservedIntrospectionKey(token.key)) {
				transport.close()
				throw new Error(
					`Devtools requires a standalone state in the supplied Silo: ` +
						token.key,
				)
			}
			const entry = {
				token,
				validateEdit,
				revision: 0,
				isPresent: () => definitions.get(token.key) === definition,
			}
			return [token.key, entry] as const
		}),
	)
	if (entries.size !== allowlist.length) {
		transport.close()
		throw new Error(`Duplicate remote devtools state keys`)
	}

	const subscriptions: (() => void)[] = []
	let closed = false
	const publish = () => {
		if (closed) return
		transport.send({
			type: `snapshot`,
			control,
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
						const cached = control
							? { present: true, value: silo.getState(token) }
							: peekState(silo.store, token.key)
						if (!cached.present) return { ...base, error: `Value is not cached` }
						const { value } = cached
						if (isWorkerDevtoolsValue(value))
							return {
								...base,
								value,
								editable: control && Boolean(validateEdit) && value !== null,
							}
						return { ...base, error: `Expected a synchronous JSON primitive` }
					} catch {
						return { ...base, error: `Could not read remote state` }
					}
				},
			),
		})
	}
	const scheduleSnapshot = batchDevtoolsSnapshots(publish, dispose)
	function dispose(notify = true) {
		if (closed) return
		closed = true
		for (const unsubscribe of subscriptions) unsubscribe()
		closeDevtoolsTransport(transport, notify)
	}
	function receive(data: PanelMessage): void {
		if (closed) return
		if (data?.type === `close`) {
			dispose(false)
			return
		}
		if (data?.type !== `edit`) return
		const entry = entries.get(data.key)
		try {
			if (!control) throw new Error(`Remote devtools is inspection only`)
			if (
				entry?.token.type !== `atom` ||
				!entry.validateEdit ||
				!entry.isPresent()
			)
				throw new Error(`Remote state is readonly or unavailable`)
			if (data.revision !== entry.revision)
				throw new Error(
					`Remote state changed while you were editing. Try again with the current value.`,
				)
			const current = silo.getState(entry.token)
			if (
				!isWorkerDevtoolsValue(current) ||
				current === null ||
				!isWorkerDevtoolsValue(data.value) ||
				typeof current !== typeof data.value ||
				!entry.validateEdit(data.value)
			)
				throw new Error(`Remote store rejected this value`)
			silo.setState(entry.token, data.value)
		} catch (error) {
			reportDevtoolsError(transport, error, dispose)
		}
		scheduleSnapshot()
	}
	try {
		if (control) {
			for (const entry of entries.values()) {
				subscriptions.push(
					silo.subscribe(entry.token, () => {
						entry.revision++
						scheduleSnapshot()
					}),
				)
			}
		} else {
			subscriptions.push(
				observeStore(silo.store, ({ states, values }) => {
					for (const key of entries.keys()) {
						if (states.has(key) || values.has(key)) {
							scheduleSnapshot()
							break
						}
					}
				}),
			)
		}
		transport.listen(receive, dispose)
		publish()
	} catch (error) {
		dispose(false)
		throw error
	}
	return dispose
}
