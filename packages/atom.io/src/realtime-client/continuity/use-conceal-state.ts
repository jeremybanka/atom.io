import type { AtomToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type { Store } from "atom.io/internal"
import { disposeAtom } from "atom.io/internal"

export function useConcealState(store: Store) {
	return (concealed: AtomToken<Json.Serializable>[]): void => {
		for (const token of concealed) {
			disposeAtom(store, token)
		}
	}
}
