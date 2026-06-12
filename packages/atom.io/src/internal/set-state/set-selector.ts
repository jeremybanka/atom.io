import { writeToCache } from "../caching.ts"
import { readOrComputeValue } from "../get-state/index.ts"
import { markDone, type OpenOperation } from "../operation.ts"
import type { WritableSelector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { become } from "./become.ts"
import type { ProtoUpdate } from "./operate-on-store.ts"

export function setSelector<T>(
	target: Store & { operation: OpenOperation<any> },
	selector: WritableSelector<T, any>,
	next: NoInfer<T> | ((oldValue: T) => NoInfer<T>),
): ProtoUpdate<T> {
	let oldValue: T
	let newValue: T
	let constant: T

	const { type, key } = selector

	switch (selector.type) {
		case `writable_pure_selector`:
			oldValue = readOrComputeValue(target, selector, `mut`)
			newValue = become(next, oldValue)
			newValue = writeToCache(target, selector, newValue)
			break
		case `writable_held_selector`:
			constant = selector.const
			become(next, constant)
			oldValue = constant
			newValue = constant
	}

	target.logger.info(`⭐`, type, key, `setting to`, newValue)
	markDone(target, key)
	selector.setSelf(newValue)
	return { oldValue, newValue }
}
