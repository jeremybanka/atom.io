export class MapOverlay<K, V> extends Map<K, V> {
	public deleted: Set<K> = new Set()
	public changed: Set<K> = new Set()
	protected readonly source: Map<K, V>
	private appendedSource: Set<K> = new Set()
	private sourceCleared = false

	public constructor(source: Map<K, V>) {
		super()
		this.source = source
	}

	public get(key: K): V | undefined {
		const has = super.has(key)
		if (has) {
			return super.get(key)
		}
		if (!this.deleted.has(key) && this.source.has(key)) {
			const value = this.source.get(key)
			return value
		}
		return undefined
	}

	public getOrInsert(key: K, defaultValue: V): V {
		if (this.has(key)) {
			return this.get(key) as V
		}
		this.set(key, defaultValue)
		return defaultValue
	}

	public getOrInsertComputed(key: K, callback: (key: K) => V): V {
		if (this.has(key)) {
			return this.get(key) as V
		}
		const value = callback(key)
		this.set(key, value)
		return value
	}

	public set(key: K, value: V): this {
		const shouldAppendSourceKey =
			this.appendedSource.has(key) ||
			(this.sourceCleared && this.deleted.has(key))
		if (this.source.has(key) && shouldAppendSourceKey) {
			this.deleted.delete(key)
			this.changed.delete(key)
			this.appendedSource.add(key)
		} else if (this.source.has(key)) {
			this.deleted.delete(key)
			this.appendedSource.delete(key)
			this.changed.add(key)
		}
		return super.set(key, value)
	}

	public hasOwn(key: K): boolean {
		return super.has(key)
	}

	public has(key: K): boolean {
		return super.has(key) || (!this.deleted.has(key) && this.source.has(key))
	}

	public delete(key: K): boolean {
		if (this.source.has(key)) {
			this.deleted.add(key)
			this.changed.delete(key)
			this.appendedSource.delete(key)
		}
		return super.delete(key)
	}

	public clear(): void {
		this.deleted = new Set(this.source.keys())
		this.appendedSource.clear()
		this.changed.clear()
		this.sourceCleared = true
		super.clear()
	}

	public *[Symbol.iterator](): MapIterator<[K, V]> {
		for (const [key, value] of this.source) {
			if (this.deleted.has(key) || this.appendedSource.has(key)) {
				continue
			}
			if (this.changed.has(key)) {
				yield [key, super.get(key) as V]
			} else {
				yield [key, value]
			}
		}
		for (const entry of super[Symbol.iterator]()) {
			if (!this.changed.has(entry[0])) {
				yield entry
			}
		}
	}
	public *entries(): MapIterator<[K, V]> {
		yield* this[Symbol.iterator]()
	}
	public *keys(): MapIterator<K> {
		for (const key of this.source.keys()) {
			if (!this.deleted.has(key) && !this.appendedSource.has(key)) {
				yield key
			}
		}
		for (const key of super.keys()) {
			if (!this.changed.has(key)) {
				yield key
			}
		}
	}
	public *values(): MapIterator<V> {
		for (const [, value] of this[Symbol.iterator]()) {
			yield value
		}
	}
	public forEach(
		callbackfn: (value: V, key: K, map: Map<K, V>) => void,
		thisArg?: any,
	): void {
		for (const [key, value] of this[Symbol.iterator]()) {
			callbackfn.call(thisArg, value, key, this)
		}
	}

	public get size(): number {
		return (
			super.size +
			this.source.size -
			this.changed.size -
			this.deleted.size -
			this.appendedSource.size
		)
	}
}
