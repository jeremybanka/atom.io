import { getContinuityKey } from "./get-epoch-number.ts"
import type { RootStore } from "./is-root-store.ts"

export function setEpochNumberOfContinuity(
	store: RootStore,
	continuityKey: string,
	newEpoch: number,
): void {
	store.transactionMeta.epoch.set(continuityKey, newEpoch)
}

export function setEpochNumberOfAction(
	store: RootStore,
	transactionKey: string,
	newEpoch: number,
): void {
	const continuityKey = getContinuityKey(store, transactionKey)

	if (continuityKey !== undefined) {
		store.transactionMeta.epoch.set(continuityKey, newEpoch)
	}
}
