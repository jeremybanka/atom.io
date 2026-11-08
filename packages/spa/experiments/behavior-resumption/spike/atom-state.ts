import type { RegularAtomToken } from "atom.io"
import {
	createRegularAtom,
	getFromStore,
	setIntoStore,
	Store,
	subscribeToState,
} from "atom.io/internal"

import type { StateAdapter } from "../host/scope.ts"

/** Atom.io is one consumer of the host contract; this adapter never reads the DOM. */
export function createAtomState(onStore: () => void): StateAdapter {
	let store: Store | undefined
	let disposed = false
	return {
		create(id, value) {
			if (disposed) throw new Error(`resume: disposed state adapter`)
			if (!store) {
				store = new Store({
					name: `resume-spike-client`,
					lifespan: `ephemeral`,
					isProduction: true,
				})
				onStore()
			}
			const boundStore = store
			const token: RegularAtomToken<number> = createRegularAtom(
				boundStore,
				{ key: id, default: value },
				undefined,
			)
			return {
				get: () => getFromStore(boundStore, token),
				set: (next) => {
					setIntoStore(boundStore, token, next)
				},
				subscribe: (write) =>
					subscribeToState(
						boundStore,
						token,
						`resume:text:${id}`,
						({ newValue }) => {
							write(newValue)
						},
					),
			}
		},
		dispose() {
			disposed = true
			store = undefined
		},
	}
}
