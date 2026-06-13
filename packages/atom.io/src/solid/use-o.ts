import type { ReadableFamilyToken, ReadableToken, ViewOf } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { arbitrary, getFromStore, subscribeToState } from "atom.io/internal"
import { useContext } from "solid-js"

import { parseStateOverloads } from "./parse-state-overloads.ts"
import { StoreContext } from "./store-context.ts"
import { useSyncExternalStore } from "./use-sync-external-store-solid.ts"

export function useO<T, E = never>(
	token: ReadableToken<T, any, E>,
): () => ViewOf<E | T>

export function useO<T, K extends Canonical, E = never>(
	token: ReadableFamilyToken<T, K, E>,
	key: NoInfer<K>,
): () => ViewOf<E | T>

export function useO<T, K extends Canonical, E = never>(
	...params:
		| [ReadableFamilyToken<T, K, E>, NoInfer<K>]
		| [ReadableToken<T, any, E>]
): () => ViewOf<E | T> {
	const store = useContext(StoreContext)
	const token = parseStateOverloads(store, ...params)
	const id = arbitrary()
	const sub = (dispatch: () => void) =>
		subscribeToState<T, E>(store, token, `use-o:${id}`, dispatch)
	const get = () => getFromStore(store, token)
	return useSyncExternalStore<ViewOf<E | T>>(sub, get)
}
