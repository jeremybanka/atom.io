function* iterateSetLike<T>(setLike: ReadonlySetLike<T>): IterableIterator<T> {
	const iterator = setLike.keys()
	for (let next = iterator.next(); !next.done; next = iterator.next()) {
		yield next.value
	}
}

export class SetOverlay<T> extends Set<T> {
	public deleted: Set<T> = new Set()
	public source: Set<T>
	private appendedSource: Set<T> = new Set()
	private sourceCleared = false

	public constructor(source: Set<T>) {
		super()
		this.source = source
	}

	public add(value: T): this {
		const shouldAppendSourceValue =
			this.appendedSource.has(value) ||
			(this.sourceCleared && this.deleted.has(value))
		if (this.source.has(value) && shouldAppendSourceValue) {
			this.deleted.delete(value)
			this.appendedSource.add(value)
			return super.add(value)
		}
		if (this.source.has(value)) {
			this.deleted.delete(value)
			this.appendedSource.delete(value)
			return this
		}
		return super.add(value)
	}

	public hasOwn(member: T): boolean {
		return super.has(member)
	}

	public has(key: T): boolean {
		return super.has(key) || (!this.deleted.has(key) && this.source.has(key))
	}

	public delete(key: T): boolean {
		if (this.source.has(key)) {
			this.deleted.add(key)
			this.appendedSource.delete(key)
			super.delete(key)
			return true
		}
		return super.delete(key)
	}

	public clear(): void {
		this.deleted = new Set(this.source)
		this.appendedSource.clear()
		this.sourceCleared = true
		super.clear()
	}

	public *[Symbol.iterator](): SetIterator<T> {
		for (const value of this.source) {
			if (!this.deleted.has(value) && !this.appendedSource.has(value)) {
				yield value
			}
		}
		yield* super[Symbol.iterator]()
	}

	public *keys(): SetIterator<T> {
		yield* this[Symbol.iterator]()
	}

	public *values(): SetIterator<T> {
		yield* this[Symbol.iterator]()
	}

	public *entries(): SetIterator<[T, T]> {
		for (const value of this[Symbol.iterator]()) {
			yield [value, value]
		}
	}

	public forEach(
		callbackfn: (value: T, value2: T, set: Set<T>) => void,
		thisArg?: any,
	): void {
		for (const value of this[Symbol.iterator]()) {
			callbackfn.call(thisArg, value, value, this)
		}
	}

	public union<U>(other: ReadonlySetLike<U>): Set<T | U> {
		const result = new Set<T | U>(this)
		for (const value of iterateSetLike(other)) {
			result.add(value)
		}
		return result
	}

	public intersection<U>(other: ReadonlySetLike<U>): Set<T & U> {
		const result = new Set<T & U>()
		const otherSet = other as ReadonlySetLike<unknown>
		const thisSet = this as ReadonlySetLike<unknown>
		if (this.size <= other.size) {
			for (const value of this) {
				if (otherSet.has(value)) {
					result.add(value as T & U)
				}
			}
		} else {
			for (const value of iterateSetLike(other)) {
				if (thisSet.has(value)) {
					result.add(value as T & U)
				}
			}
		}
		return result
	}

	public difference<U>(other: ReadonlySetLike<U>): Set<T> {
		const result = new Set<T>()
		const otherSet = other as ReadonlySetLike<unknown>
		if (this.size <= other.size) {
			for (const value of this) {
				if (!otherSet.has(value)) {
					result.add(value)
				}
			}
		} else {
			for (const value of this) {
				result.add(value)
			}
			for (const value of iterateSetLike(other)) {
				result.delete(value as unknown as T)
			}
		}
		return result
	}

	public symmetricDifference<U>(other: ReadonlySetLike<U>): Set<T | U> {
		const result = new Set<T | U>(this)
		for (const value of iterateSetLike(other)) {
			if (result.has(value)) {
				result.delete(value)
			} else {
				result.add(value)
			}
		}
		return result
	}

	public isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
		if (this.size > other.size) {
			return false
		}
		for (const value of this) {
			if (!other.has(value)) {
				return false
			}
		}
		return true
	}

	public isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
		if (this.size < other.size) {
			return false
		}
		for (const value of iterateSetLike(other)) {
			if (!this.has(value as T)) {
				return false
			}
		}
		return true
	}

	public isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
		if (this.size <= other.size) {
			for (const value of this) {
				if (other.has(value)) {
					return false
				}
			}
		} else {
			for (const value of iterateSetLike(other)) {
				if (this.has(value as T)) {
					return false
				}
			}
		}
		return true
	}

	public *iterateOwn(): SetIterator<T> {
		yield* super[Symbol.iterator]()
	}

	public get size(): number {
		return (
			super.size +
			this.source.size -
			this.deleted.size -
			this.appendedSource.size
		)
	}
}
