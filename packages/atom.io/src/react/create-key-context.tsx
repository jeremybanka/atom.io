import * as React from "react"

import { StoreContext } from "./store-context.tsx"

const MISSING_KEY_CONTEXT_VALUE = Symbol(`missing key context value`)

export type KeyContextProviderProps<Key> = React.PropsWithChildren<{
	value: Key
}>

export type KeyContext<Key> = Readonly<{
	Provider: React.FC<KeyContextProviderProps<Key>>
	use: (...fallback: [] | [Key]) => Key
}>

/**
 * Create a named React context for supplying an application key to a subtree.
 *
 * Calling `use()` without a matching provider throws. Passing a fallback key
 * returns that key instead and logs a warning through the current atom.io store.
 */
export function createKeyContext<Key>(name: string): KeyContext<Key> {
	const Context = React.createContext<Key | typeof MISSING_KEY_CONTEXT_VALUE>(
		MISSING_KEY_CONTEXT_VALUE,
	)
	Context.displayName = `${name}.Context`

	const Provider: React.FC<KeyContextProviderProps<Key>> = ({
		children,
		value,
	}) => <Context.Provider value={value}>{children}</Context.Provider>
	Provider.displayName = `${name}.Provider`

	function useKey(...fallback: [] | [Key]): Key {
		const contextualKey = React.useContext(Context)
		const store = React.useContext(StoreContext)
		const isMissing = contextualKey === MISSING_KEY_CONTEXT_VALUE
		const hasFallback = fallback.length === 1
		const fallbackKey = fallback[0]

		React.useEffect(() => {
			if (isMissing && hasFallback) {
				store.logger.warn(
					`💁`,
					`key`,
					name,
					`used a fallback because ${name}.use() was called outside <${name}.Provider>:`,
					fallbackKey,
				)
			}
		}, [fallbackKey, hasFallback, isMissing, store, name])

		if (!isMissing) return contextualKey
		if (hasFallback) return fallbackKey as Key

		throw new Error(
			`atom.io: ${name}.use() was called outside <${name}.Provider>. Wrap this component in the provider or pass a fallback key to ${name}.use(fallback).`,
		)
	}

	return { Provider, use: useKey }
}
