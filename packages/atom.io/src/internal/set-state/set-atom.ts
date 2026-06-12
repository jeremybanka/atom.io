import { readFromCache, writeToCache } from "../caching.ts"
import { readOrComputeValue } from "../get-state/read-or-compute-value.ts"
import { isFn } from "../is-fn.ts"
import type { OpenOperation } from "../operation.ts"
import { markDone } from "../operation.ts"
import type { Atom } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { evictDownstreamFromAtom } from "./evict-downstream.ts"
import type { ProtoUpdate } from "./operate-on-store.ts"

const UNSET = Symbol(`UNSET`)

export function setAtom<T>(
	target: Store & { operation: OpenOperation<any> },
	atom: Atom<T, any>,
	next: NoInfer<T> | ((oldValue: T) => NoInfer<T>),
): ProtoUpdate<T> {
	let oldValue: T | typeof UNSET
	let newValue: T
	if (isFn(next)) {
		const prev = readOrComputeValue(target, atom, `mut`)
		oldValue = prev
		newValue = next(prev)
	} else {
		if (target.valueMap.has(atom.key)) {
			oldValue = readFromCache(target, atom, `mut`)
		} else {
			if (atom.type === `atom` && !isFn(atom.default)) {
				oldValue = atom.default
			} else {
				oldValue = UNSET
			}
		}
		newValue = next
	}
	target.logger.info(`⭐`, `atom`, atom.key, `setting value`, newValue)
	newValue = writeToCache(target, atom, newValue)
	markDone(target, atom.key)
	evictDownstreamFromAtom(target, atom)
	if (oldValue === UNSET) {
		return { newValue }
	}
	return { oldValue, newValue }
}
