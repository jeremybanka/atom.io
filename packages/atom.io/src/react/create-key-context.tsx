import * as React from "react"

import { StoreContext } from "./store-context.tsx"

const MISSING_KEY_CONTEXT_VALUE = Symbol(`missing key context value`)
const captureOwnerStack = Reflect.get(React, `captureOwnerStack`) as
	| (() => string | null)
	| undefined

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
 * and logs a warning for each misplaced rendered consumer. If no fallback is
 * supplied, `use()` returns `Key | undefined` without warning.
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
	const warnedConsumerBranchesByStore = new WeakMap<object, Set<string>>()
	Context.displayName = `${name}.Context`

	const Provider: React.FC<KeyContextProviderProps<Key>> = ({
		children,
		value,
	}) => <Context.Provider value={value}>{children}</Context.Provider>
	Provider.displayName = `${name}.Provider`

	function useKey(): Key | undefined {
		const consumerId = React.useId()
		const contextualKey = React.useContext(Context)
		const store = React.useContext(StoreContext)
		const isMissing = contextualKey === MISSING_KEY_CONTEXT_VALUE
		const hasFallback = fallback.length === 1
		const fallbackKey = fallback[0]

		if (isMissing && hasFallback) {
			const ownerStack = captureOwnerStack?.() ?? null
			const consumerBranch = `${consumerId}\n${ownerStack ?? ``}`
			let warnedConsumerBranches = warnedConsumerBranchesByStore.get(store)

			if (!warnedConsumerBranches) {
				warnedConsumerBranches = new Set()
				warnedConsumerBranchesByStore.set(store, warnedConsumerBranches)
			}

			if (!warnedConsumerBranches.has(consumerBranch)) {
				warnedConsumerBranches.add(consumerBranch)

				const consumerTrace = new Error(
					`${name}.use() was called by this misplaced consumer`,
				)
				consumerTrace.name = `AtomIOKeyContextWarning`
				Error.captureStackTrace?.(consumerTrace, useKey)

				store.logger.warn(
					`💁`,
					`key`,
					name,
					`consumer branch "${consumerId}" rendered outside <${name}.Provider>; using fallback:`,
					fallbackKey,
					consumerTrace,
					ownerStack
						? `The misplaced consumer was created along this owner path:${ownerStack}`
						: `React owner stack unavailable.`,
				)
			}
		}

		if (!isMissing) return contextualKey
		return fallbackKey
	}

	return { Provider, use: useKey }
}
