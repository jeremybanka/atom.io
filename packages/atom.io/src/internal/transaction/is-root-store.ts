import type { MapOverlay } from "atom.io/foundations/overlays"

import type { Store } from "../store/index.ts"
import type { Fn } from "../utility-types.ts"
import type {
	RootTransactionMeta,
	TransactionProgress,
} from "./transaction-meta-progress.ts"

export interface RootStore extends Store {
	transactionMeta: RootTransactionMeta
	parent: null
	child: ChildStore | null
}
export interface ChildStore extends Store {
	transactionMeta: TransactionProgress<Fn>
	parent: ChildStore | RootStore
	child: ChildStore | null
	valueMap: MapOverlay<string, any>
}

export function isRootStore(store: Store): store is RootStore {
	return store.transactionMeta.phase === `idle`
}

export function isChildStore(store: Store): store is ChildStore {
	return store.transactionMeta.phase !== `idle`
}
