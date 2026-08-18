import type { ViewOf } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Json, stringified } from "atom.io/foundations/json"

import type { AtomOnly, TimelineManageable } from "./timeline.ts"
import type {
	AtomToken,
	MutableAtomToken,
	ReadableToken,
	SelectorToken,
	TokenType,
	TransactionToken,
	WritableToken,
} from "./tokens.ts"

export type StateUpdate<T> = {
	readonly oldValue?: ViewOf<T>
	readonly newValue: ViewOf<T>
}

export type AtomUpdateEvent<A extends AtomToken<any, any, any>> = {
	type: `atom_update`
	token: A
	update: StateUpdate<TokenType<A>>
	timestamp: number
}

/** A serializable whole-value replacement for a mutable atom transaction. */
export type MutableAtomSnapshotEvent<
	A extends MutableAtomToken<any, any> = MutableAtomToken<any, any>,
> = {
	type: `mutable_atom_snapshot`
	token: A
	update: {
		oldValue: Json.Serializable
		newValue: Json.Serializable
	}
	timestamp: number
}

export type SelectorUpdateSubEvent<A extends AtomToken<any, any, any>> =
	| AtomUpdateEvent<A>
	| AtomCreationEvent<any>
export type TimelineSelectorUpdateEvent<A extends TimelineManageable> = {
	type: `selector_update`
	token: SelectorToken<any>
	subEvents: SelectorUpdateSubEvent<AtomOnly<A>>[]
	timestamp: number
}

export type AtomCreationEvent<A extends AtomToken<any, any, any>> = {
	type: `atom_creation`
	token: A
	timestamp: number
	value?: TokenType<A>
}
export type AtomDisposalEvent<A extends AtomToken<any, any, any>> = {
	type: `atom_disposal`
	token: A
	timestamp: number
	value?: TokenType<A>
}
export type AtomLifecycleEvent<A extends AtomToken<any, any, any>> =
	| AtomCreationEvent<A>
	| AtomDisposalEvent<A>

export type MoleculeCreationEvent = {
	type: `molecule_creation`
	key: Canonical
	provenance: Canonical
	timestamp: number
}
export type MoleculeDisposalEvent = {
	type: `molecule_disposal`
	key: Canonical
	provenance: stringified<Canonical>[]
	values: [key: string, value: any][]
	timestamp: number
}

export type MoleculeTransferEvent = {
	type: `molecule_transfer`
	key: Canonical
	exclusive: boolean
	from: Canonical[]
	to: Canonical[]
	timestamp: number
}

export type TransactionSubEvent =
	| AtomLifecycleEvent<AtomToken<unknown, any, any>>
	| AtomUpdateEvent<AtomToken<any, any, any>>
	| MutableAtomSnapshotEvent
	| MoleculeCreationEvent
	| MoleculeDisposalEvent
	| MoleculeTransferEvent
	| TransactionOutcomeEvent<TransactionToken<any>>

export type TransactionOutcomeEvent<T extends TransactionToken<any>> = {
	type: `transaction_outcome`
	token: T
	id: string
	timestamp: number
	subEvents: TransactionSubEvent[]
	params: Parameters<TokenType<T>>
	output: ReturnType<TokenType<T>>
}

/**
 * An isolated record of one successfully committed outermost transaction.
 * `sequence` is monotonic within the Store that emitted the event.
 */
export type TransactionCommitEvent = {
	/** Values that could not be isolated are replaced by an explicit sentinel. */
	readonly isolationFailures: readonly TransactionCommitIsolationFailure[]
	readonly outcome: TransactionOutcomeEvent<TransactionToken<any>>
	readonly sequence: number
	readonly snapshots: readonly TransactionCommitStateSnapshot[]
	readonly type: `transaction_commit`
}

export type TransactionCommitIsolationFailure = {
	readonly path: string
	readonly reason: string
}

export type TransactionCommitUncloneableValue = {
	readonly failure: TransactionCommitIsolationFailure
	readonly type: `transaction_commit_uncloneable`
}

/** The exact pre/post state retained by a committed transaction event. */
export type TransactionCommitStateSnapshot = {
	readonly newExists: boolean
	readonly newValue: unknown
	readonly oldExists: boolean
	readonly oldValue: unknown
	readonly token: AtomToken<any, any, any>
}

export type TimelineEvent<ManagedAtom extends TimelineManageable> = {
	checkpoint?: true
} & (
	| AtomUpdateEvent<AtomOnly<ManagedAtom>>
	| AtomCreationEvent<AtomOnly<ManagedAtom>>
	| AtomDisposalEvent<AtomOnly<ManagedAtom>>
	| TimelineSelectorUpdateEvent<ManagedAtom>
	| TransactionOutcomeEvent<TransactionToken<any>>
)

export type TimelineCullEvent = {
	type: `timeline_cull`
	target: `undo_steps`
	/** Logical undo steps available before collection. */
	from: number
	/** Logical undo steps remaining after collection. */
	to: number
}

export type TimelineUpdate<ManagedAtom extends TimelineManageable> = {
	type: `timeline_update`
	event:
		| TimelineEvent<ManagedAtom>
		| TimelineCullEvent
		| `clear`
		| `redo`
		| `undo`
	at: number
	length: number
}
