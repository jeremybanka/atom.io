import { Subject } from "atom.io/foundations/subject"

export class SelectorSubject<T> extends Subject<T> {
	public rootSubscriptions: Map<string, () => void> | undefined
	public updateRootSubscriptions: (() => void) | undefined

	public override next(value: T): void {
		this.updateRootSubscriptions?.()
		super.next(value)
	}

	public override subscribe(
		key: string,
		subscriber: this[`Subscriber`],
	): () => void {
		const unsubscribe = super.subscribe(key, subscriber)
		return () => {
			if (this.subscribers.get(key) !== subscriber) return
			unsubscribe()
			if (this.subscribers.size === 0) {
				const roots = this.rootSubscriptions
				this.rootSubscriptions = undefined
				this.updateRootSubscriptions = undefined
				if (roots) for (const stop of roots.values()) stop()
			}
		}
	}
}
