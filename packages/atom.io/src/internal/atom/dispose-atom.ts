import type { AtomDisposalEvent, AtomLifecycleEvent, AtomToken } from "atom.io"
import type { Subject } from "atom.io/foundations/subject"

import { getFamilyOfToken } from "../families/get-family-of-token.ts"
import { newest } from "../lineage.ts"
import { getUpdateToken } from "../mutable/index.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"
import { isChildStore } from "../transaction/index.ts"
import { hasRole } from "./has-role.ts"

export function disposeAtom(
	store: Store,
	atomToken: AtomToken<any, any, any>,
): void {
	const target = newest(store)
	const { key, family } = atomToken
	const atom = withdraw(target, atomToken)
	if (!family) {
		store.logger.error(`❌`, `atom`, key, `Standalone atoms cannot be disposed.`)
	} else {
		atom.cleanup?.()
		const valueIsSetAtDisposalTime = store.valueMap.has(atom.key)
		const familyToken = getFamilyOfToken(store, atomToken)
		const atomFamily = withdraw(store, familyToken)
		const subject = atomFamily.subject as Subject<
			AtomLifecycleEvent<AtomToken<any, any, any>>
		>

		const disposalEvent: AtomDisposalEvent<AtomToken<any, any, any>> = {
			type: `atom_disposal`,
			token: atomToken,
			timestamp: Date.now(),
		}
		if (valueIsSetAtDisposalTime) {
			const lastValue = store.valueMap.get(atom.key)
			disposalEvent.value = lastValue
		}

		subject.next(disposalEvent)

		const isChild = isChildStore(target)

		target.atoms.delete(key)
		target.valueMap.delete(key)
		target.selectorAtoms.delete(key)
		target.atomsThatAreDefault.delete(key)
		target.moleculeData.delete(family.key, family.subKey)
		store.timelineTopics.delete(key)

		if (atomToken.type === `mutable_atom`) {
			const updateToken = getUpdateToken(atomToken)
			disposeAtom(store, updateToken)
			store.trackers.delete(key)
		}
		store.logger.info(`🔥`, `atom`, key, `deleted`)
		if (isChild && target.transactionMeta.phase === `building`) {
			const mostRecentUpdate = target.transactionMeta.update.subEvents.at(-1)
			const wasMoleculeDisposal = mostRecentUpdate?.type === `molecule_disposal`
			const updateAlreadyCaptured =
				wasMoleculeDisposal &&
				mostRecentUpdate.values.some(([k]) => k === atom.family?.key)
			const isTracker = hasRole(atom, `tracker:signal`)
			if (!updateAlreadyCaptured && !isTracker) {
				target.transactionMeta.update.subEvents.push(disposalEvent)
			}
		} else {
			store.on.atomDisposal.next(atomToken)
		}
	}
}
