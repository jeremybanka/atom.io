export * from "./atom.ts"
export * from "./dispose-state.ts"
export type * from "./events.ts"
export * from "./find-state.ts"
export * from "./get-json-token.ts"
export * from "./get-state.ts"
export * from "./join.ts"
export * from "./logger.ts"
export * from "./realm.ts"
export * from "./reset-state.ts"
export * from "./selector.ts"
export * from "./set-state.ts"
export * from "./silo.ts"
export * from "./subscribe.ts"
export * from "./timeline.ts"
export type * from "./tokens.ts"
export * from "./transaction.ts"
/**
 * Loadable is used to type atoms or selectors that may at some point be initialized to or set to a {@link Promise}.
 *
 * When a Promise is cached as the value of a state in atom.io, that state will be automatically set to the resolved value of the Promise when it is resolved.
 *
 * As a result, we consider any state that can be a set to a Promise to be a "loadable" state, whose value may or may not be a Promise at any given time.
 */
export type Loadable<T> = Promise<T> | T

export type ViewOf<T> = T extends { READONLY_VIEW: infer View }
	? View
	: T extends Array<any>
		? readonly [...T]
		: T extends Set<infer U>
			? ReadonlySet<ViewOf<U>>
			: T extends Map<infer K, infer V>
				? ReadonlyMap<ViewOf<K>, ViewOf<V>>
				: T
