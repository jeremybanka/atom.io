import type { OpenOperation } from "../operation.ts"
import type { WritableState } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import type { ProtoUpdate } from "./operate-on-store.ts"
import { setAtom } from "./set-atom.ts"
import { setSelector } from "./set-selector.ts"

export function setAtomOrSelector<T>(
	target: Store & { operation: OpenOperation },
	state: WritableState<T, any>,
	value: NoInfer<T> | ((oldValue: T) => NoInfer<T>),
): ProtoUpdate<T> {
	let protoUpdate: ProtoUpdate<T>
	switch (state.type) {
		case `atom`:
		case `mutable_atom`:
			protoUpdate = setAtom(target, state, value)
			break
		case `writable_pure_selector`:
		case `writable_held_selector`:
			protoUpdate = setSelector(target, state, value)
			break
	}

	return protoUpdate
}
