import type * as AtomIO from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Store } from "atom.io/internal"
import { findInStore } from "atom.io/internal"
import type { Socket } from "atom.io/realtime"

import { pullSelectorRoots } from "./pull-selector-roots.ts"

export function pullSelectorFamilyMember<T, K extends Canonical>(
	store: Store,
	socket: Socket,
	familyToken: AtomIO.SelectorFamilyToken<T, K>,
	key: NoInfer<K>,
): () => void {
	const token = findInStore(store, familyToken, key)
	return pullSelectorRoots(store, socket, token)
}
