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
