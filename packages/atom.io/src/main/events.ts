import type { ViewOf } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { stringified } from "atom.io/foundations/json"

import type { AtomOnly, TimelineManageable } from "./timeline.ts"
import type {
	AtomToken,
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
	| MoleculeCreationEvent
	| MoleculeDisposalEvent
	| MoleculeTransferEvent
	| TransactionOutcomeEvent<TransactionToken<any>>

export type TransactionOutcomeEvent<T extends TransactionToken<any>> = {
	type: `transaction_outcome`
	token: T
	id: string
	epoch: number
	timestamp: number
	subEvents: TransactionSubEvent[]
	params: Parameters<TokenType<T>>
	output: ReturnType<TokenType<T>>
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

export type TimelineUpdate<ManagedAtom extends TimelineManageable> = {
	type: `timeline_update`
	event: TimelineEvent<ManagedAtom> | `clear` | `redo` | `undo`
	at: number
	length: number
}
