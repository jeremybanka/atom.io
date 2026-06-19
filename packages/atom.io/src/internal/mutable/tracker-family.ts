import type { AtomLifecycleEvent, MutableAtomToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { parseJson } from "atom.io/foundations/json"

import { createRegularAtomFamily } from "../families/index.ts"
import type { MutableAtomFamily, RegularAtomFamily } from "../state-types.ts"
import { withdraw } from "../store/index.ts"
import type { RootStore } from "../transaction/index.ts"
import { Tracker } from "./tracker.ts"
import type { SignalFrom, Transceiver } from "./transceiver.ts"

export class FamilyTracker<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
> {
	private trackers: Map<K, Tracker<T>> = new Map()

	public readonly latestSignalAtoms: RegularAtomFamily<SignalFrom<T> | null, K>
	public readonly mutableAtoms: MutableAtomFamily<T, K>

	public constructor(mutableAtoms: MutableAtomFamily<T, K>, store: RootStore) {
		const latestSignalAtoms = createRegularAtomFamily<
			SignalFrom<T> | null,
			K,
			never
		>(
			store,
			{
				key: `*${mutableAtoms.key}`,
				default: null,
			},
			[`mutable`, `updates`],
		)
		this.latestSignalAtoms = withdraw(store, latestSignalAtoms)
		this.mutableAtoms = mutableAtoms
		const trackerFamilyWatchesForCreationAndDisposalEvents = (
			event: AtomLifecycleEvent<MutableAtomToken<T, K>>,
		) => {
			const { type, token } = event
			if (token.family) {
				const key = parseJson(token.family.subKey)
				switch (type) {
					case `atom_creation`:
						this.trackers.set(key, new Tracker<T>(token, store))
						break
					case `atom_disposal`: {
						const tracker = this.trackers.get(key)
						if (tracker) {
							tracker[Symbol.dispose]()
							this.trackers.delete(key)
						}
					}
				}
			}
		}
		this.mutableAtoms.subject.subscribe(
			`store=${store.config.name}::tracker-atom-family`,
			trackerFamilyWatchesForCreationAndDisposalEvents,
		)
	}
}
