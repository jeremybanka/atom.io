import type {
	Loadable,
	ReadableFamilyToken,
	ReadableToken,
	ViewOf,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { withdraw } from "atom.io/internal"

import { type Accessor, owner, resolveStateToken, useValue } from "./core.ts"

export type LoadableValue<T> = { loading: boolean; value: T }

export function useLoadable<T, E>(
	token: ReadableToken<Loadable<T>, any, E>,
): Accessor<`LOADING` | LoadableValue<ViewOf<T | E>>>
export function useLoadable<T, K extends Canonical, E>(
	token: ReadableFamilyToken<Loadable<T>, K, E>,
	key: NoInfer<K>,
): Accessor<`LOADING` | LoadableValue<ViewOf<T | E>>>
export function useLoadable<T, E>(
	token: ReadableToken<Loadable<T>, any, E>,
	fallback: NoInfer<T>,
): Accessor<LoadableValue<ViewOf<T>> & { error?: E }>
export function useLoadable<T, K extends Canonical, E>(
	token: ReadableFamilyToken<Loadable<T>, K, E>,
	key: NoInfer<K>,
	fallback: NoInfer<T>,
): Accessor<LoadableValue<ViewOf<T>> & { error?: E }>
export function useLoadable(
	...params:
		| [ReadableToken<any, any, any>]
		| [ReadableToken<any, any, any>, unknown]
		| [ReadableFamilyToken<any, Canonical, any>, Canonical]
		| [ReadableFamilyToken<any, Canonical, any>, Canonical, unknown]
): Accessor<`LOADING` | (LoadableValue<unknown> & { error?: unknown })> {
	const store = owner!._root._store
	const [token] = params
	const family = token.type.endsWith(`_family`)
	const selected = resolveStateToken(token, params[1] as Canonical)
	const read = useValue(selected)
	const fallbackIndex = family ? 2 : 1
	const fallback = params[fallbackIndex]
	const hasFallback = params.length > fallbackIndex
	let available = hasFallback
	let previous = fallback
	let error: unknown
	return () => {
		const value = read()
		const loading = value instanceof Promise
		if (!loading) {
			previous = value
			available = true
			const state = withdraw(store, selected)
			error =
				hasFallback &&
				`catch` in state &&
				state.catch.some((ErrorType) => value instanceof ErrorType)
					? value
					: undefined
		}
		if (!available) return `LOADING`
		return error
			? { loading, value: fallback, error }
			: { loading, value: previous }
	}
}
