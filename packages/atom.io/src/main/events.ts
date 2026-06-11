import type { ViewOf } from "atom.io"
import type { Canonical, stringified } from "atom.io/json"

import type { AtomOnly, TimelineManageable } from "./timeline"
import type { AtomToken, SelectorToken, TransactionToken } from "./tokens"
import type { TokenType } from "./validators"

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
	AtomUpdateEvent<A>
export type TimelineSelectorUpdateEvent<A extends TimelineManageable> = {
	type: `selector_update`
	token: SelectorToken<any>
	subEvents: SelectorUpdateSubEvent<AtomOnly<A>>[]
	timestamp: number
}

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
	| TimelineSelectorUpdateEvent<ManagedAtom>
	| TransactionOutcomeEvent<TransactionToken<any>>
)

export type TimelineUpdate<ManagedAtom extends TimelineManageable> = {
	type: `timeline_update`
	event: TimelineEvent<ManagedAtom> | `clear` | `redo` | `undo`
	at: number
	length: number
}
