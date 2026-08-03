export type DeepReadonly<T> = T extends (...parameters: any[]) => any
	? T
	: T extends ReadonlyMap<infer Key, infer Value>
		? ReadonlyMap<DeepReadonly<Key>, DeepReadonly<Value>>
		: T extends ReadonlySet<infer Value>
			? ReadonlySet<DeepReadonly<Value>>
			: T extends object
				? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
				: T

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
