import * as React from "react"

import { StoreContext } from "./store-context.tsx"

const MISSING_KEY_CONTEXT_VALUE = Symbol(`missing key context value`)

export type KeyContextProviderProps<Key> = React.PropsWithChildren<{
	value: Key
}>

export type KeyContext<Key, Fallback = undefined> = Readonly<{
	Provider: React.FC<KeyContextProviderProps<Key>>
	use: () => Key | Fallback
}>

/**
 * Create a named React context for supplying an application key to a subtree.
 *
 * Calling `use()` without a matching provider returns the context's fallback
 * and logs a warning through the current atom.io store. If no fallback is
 * supplied, `use()` returns `Key | undefined`.
 */
export function createKeyContext<Key>(name: string): KeyContext<Key, undefined>
export function createKeyContext<Key>(
	name: string,
	fallback: Key,
): KeyContext<Key, Key>
export function createKeyContext<Key>(
	name: string,
	...fallback: [] | [Key]
): KeyContext<Key, Key | undefined> {
	const Context = React.createContext<Key | typeof MISSING_KEY_CONTEXT_VALUE>(
		MISSING_KEY_CONTEXT_VALUE,
	)
	Context.displayName = `${name}.Context`

	const Provider: React.FC<KeyContextProviderProps<Key>> = ({
		children,
		value,
	}) => <Context.Provider value={value}>{children}</Context.Provider>
	Provider.displayName = `${name}.Provider`

	function useKey(): Key | undefined {
		const contextualKey = React.useContext(Context)
		const store = React.useContext(StoreContext)
		const isMissing = contextualKey === MISSING_KEY_CONTEXT_VALUE
		const fallbackKey = fallback[0]

		React.useEffect(() => {
			if (isMissing) {
				store.logger.warn(
					`💁`,
					`key`,
					name,
					`used its fallback because ${name}.use() was called outside <${name}.Provider>:`,
					fallbackKey,
				)
			}
		}, [fallbackKey, isMissing, store, name])

		if (!isMissing) return contextualKey
		return fallbackKey
	}

	return { Provider, use: useKey }
}
