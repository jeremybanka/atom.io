import type { ReadableFamilyToken, ReadableToken, ViewOf } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { getFromStore, subscribeToState } from "atom.io/internal"
import {
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react"

import { parseStateOverloads } from "./parse-state-overloads.ts"
import { StoreContext } from "./store-context.tsx"

export function useO<T, E = never>(
	token: ReadableToken<T, any, E>,
): ViewOf<E | T>

export function useO<T, K extends Canonical, E = never>(
	token: ReadableFamilyToken<T, K, E>,
	key: NoInfer<K>,
): ViewOf<E | T>

export function useO<T, K extends Canonical, E = never>(
	...params:
		| [ReadableFamilyToken<T, K, E>, NoInfer<K>]
		| [ReadableToken<T, any, E>]
): ViewOf<E | T> {
	const store = useContext(StoreContext)
	const token = parseStateOverloads(store, ...params)
	const id = useId()

	if (
		token.type === `mutable_atom` ||
		token.type === `readonly_held_selector` ||
		token.type === `writable_held_selector`
	) {
		const [, dispatch] = useState<number>(0)
		const sourceRef = useRef<{
			store: typeof store
			tokenKey: string
			value: ViewOf<E | T>
		} | null>(null)
		let source = sourceRef.current
		if (
			source === null ||
			source.store !== store ||
			source.tokenKey !== token.key
		) {
			source = {
				store,
				tokenKey: token.key,
				value: getFromStore(store, token),
			}
			sourceRef.current = source
		}
		useEffect(() => {
			const unsub = subscribeToState<T, E>(
				store,
				token,
				`use-o:${id}`,
				({ newValue }) => {
					source.value = newValue
					dispatch((c) => c + 1)
				},
			)
			return unsub
		}, [store, token.key])
		return source.value
	}

	const sub = useCallback(
		(dispatch: () => void) =>
			subscribeToState<T, E>(store, token, `use-o:${id}`, dispatch),
		[store, token.key],
	)
	const get = useCallback(() => getFromStore(store, token), [store, token.key])
	return useSyncExternalStore<ViewOf<E | T>>(sub, get, get)
}
