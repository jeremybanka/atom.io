import type { AtomToken } from "atom.io"

import { getFamilyOfToken } from "../families/get-family-of-token"
import { newest } from "../lineage"
import { getUpdateToken } from "../mutable"
import type { FamilyMemberLifecycleEvent } from "../state-types"
import type { Store } from "../store"
import { withdraw } from "../store"
import type { Subject } from "../subject"
import { isChildStore } from "../transaction"

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
		const familyToken = getFamilyOfToken(store, atomToken)
		const atomFamily = withdraw(store, familyToken)
		const subject = atomFamily.subject as Subject<
			FamilyMemberLifecycleEvent<AtomToken<any, any, any>>
		>

		subject.next({
			type: `family_member_disposal`,
			token: atomToken,
		})

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
		if (!isChild || target.transactionMeta.phase !== `building`) {
			store.on.atomDisposal.next(atomToken)
		}
	}
}
