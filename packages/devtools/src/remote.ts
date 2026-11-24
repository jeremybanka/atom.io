import type { ReadonlyPureSelectorToken, RegularAtomToken, Silo } from "atom.io"
import { isReservedIntrospectionKey } from "atom.io/internal"
import { observeStore, peekState } from "atom.io/introspection"

import {
	batchDevtoolsUpdates,
	closeDevtoolsTransport,
	type DevtoolsStoreTransport,
	reportDevtoolsError,
} from "./transport.ts"
import type {
	PanelMessage,
	RemotePrimitive,
	RemoteState,
} from "./remote-protocol.ts"
import { isRemotePrimitive, REMOTE_PROTOCOL_VERSION } from "./remote-protocol.ts"
import { exposeWholeStore } from "./remote-store.ts"

export type {
	DevtoolsPanelTransport,
	DevtoolsStoreTransport,
	DevtoolsTransport,
} from "./transport.ts"
export type {
	PanelMessage as DevtoolsPanelMessage,
	RemotePrimitive as DevtoolsPrimitive,
	RemoteMessage as DevtoolsStoreMessage,
} from "./remote-protocol.ts"

type ValidateEdit = (value: RemotePrimitive) => boolean
export type DevtoolsState =
	| { token: RegularAtomToken<RemotePrimitive>; validateEdit?: ValidateEdit }
	| {
			token: ReadonlyPureSelectorToken<RemotePrimitive>
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
	const changed = new Set<string>()
	let closed = false
	let sequence = 0
	function readState({
		token,
		validateEdit,
		revision,
		isPresent,
	}: NonNullable<ReturnType<typeof entries.get>>): RemoteState {
		const kind = token.type === `atom` ? `atom` : `selector`
		const base = { key: token.key, revision, kind, editable: false } as const
		if (!isPresent()) return { ...base, error: `State is no longer available` }
		try {
			const cached = control
				? { present: true, value: silo.getState(token) }
				: peekState(silo.store, token.key)
			if (!cached.present) return { ...base, error: `Value is not cached` }
			const { value } = cached
			if (isRemotePrimitive(value))
				return {
					...base,
					value,
					editable: control && Boolean(validateEdit) && value !== null,
				}
			return { ...base, error: `Expected a synchronous JSON primitive` }
		} catch {
			return { ...base, error: `Could not read remote state` }
		}
	}
	const scheduleUpdate = batchDevtoolsUpdates(() => {
		if (closed) return
		const states = Array.from(changed, (key) => readState(entries.get(key)!))
		changed.clear()
		transport.send({ type: `snapshot-update`, sequence: ++sequence, states })
	}, dispose)
	const scheduleState = (key: string) => {
		changed.add(key)
		scheduleUpdate()
	}
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
			if (entry && !entry.isPresent()) scheduleState(data.key)
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
				!isRemotePrimitive(current) ||
				current === null ||
				!isRemotePrimitive(data.value) ||
				typeof current !== typeof data.value ||
				!entry.validateEdit(data.value)
			)
				throw new Error(`Remote store rejected this value`)
			silo.setState(entry.token, data.value)
		} catch (error) {
			reportDevtoolsError(transport, error, dispose)
		}
	}
	try {
		if (control) {
			for (const entry of entries.values()) {
				subscriptions.push(
					silo.subscribe(entry.token, () => {
						entry.revision++
						scheduleState(entry.token.key)
					}),
				)
			}
		}
		subscriptions.push(
			observeStore(silo.store, ({ states, values }) => {
				for (const key of new Set(control ? states : [...states, ...values])) {
					if (entries.has(key)) scheduleState(key)
				}
			}),
		)
		transport.listen(receive, dispose)
		transport.send({
			type: `snapshot`,
			version: REMOTE_PROTOCOL_VERSION,
			control,
			states: Array.from(entries.values(), readState),
		})
	} catch (error) {
		dispose(false)
		throw error
	}
	return dispose
}
