export type Flat<R extends { [K in PropertyKey]: any }> = {
	[K in keyof R]: R[K]
}

export type ViewOf<T> = T extends { READONLY_VIEW: infer View }
	? View
	: T extends Array<any>
		? readonly [...T]
		: T extends Set<infer U>
			? ReadonlySet<ViewOf<U>>
			: T extends Map<infer K, infer V>
				? ReadonlyMap<ViewOf<K>, ViewOf<V>>
				: T
