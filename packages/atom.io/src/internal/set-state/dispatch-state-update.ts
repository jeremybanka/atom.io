import type {
	AtomCreationEvent,
	AtomToken,
	AtomUpdateEvent,
	StateUpdate,
	TimelineEvent,
	TransactionSubEvent,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical/index.ts"
import type { Subject } from "atom.io/foundations/subject"

import { hasRole } from "../atom/index.ts"
import { readOrComputeValue } from "../get-state/index.ts"
import { newest } from "../lineage.ts"
import type { Transceiver } from "../mutable/index.ts"
import { isTransceiver } from "../mutable/index.ts"
import type { OpenOperation } from "../operation.ts"
import type {
	AtomFamily,
	MutableAtom,
	WritableFamily,
	WritableState,
} from "../state-types.ts"
import { deposit, type Store } from "../store/index.ts"
import { isChildStore, isRootStore } from "../transaction/index.ts"
import { evictDownstreamFromAtom } from "./evict-downstream.ts"
import type { ProtoUpdate } from "./operate-on-store.ts"

export function dispatchOrDeferStateUpdate<T, E>(
	target: Store & { operation: OpenOperation<any> },
	state: WritableState<T, E>,
	proto: ProtoUpdate<E | T>,
	stateIsNewlyCreated: boolean,
	family?: WritableFamily<T, any, E>,
): void {
	const { oldValue, newValue } = proto
	const hasOldValue = `oldValue` in proto
	const token = deposit(state)
	if (stateIsNewlyCreated && family) {
		state.subject.next({ newValue })

		const innerTarget = newest(target)
		if (token.family) {
			switch (token.type) {
				case `atom`:
				case `mutable_atom`:
					const atomCreationEvent: AtomCreationEvent<AtomToken<T, any, E>> &
						TimelineEvent<AtomToken<T, any, E>> = {
						checkpoint: true,
						type: `atom_creation`,
						token,
						timestamp: Date.now(),
						value: newValue,
					}
					target.operation.subEvents.push(atomCreationEvent)
					const familySubject = (family as AtomFamily<T, any, E>)
						.subject as Subject<AtomCreationEvent<AtomToken<T, any, E>>>
					familySubject.next(atomCreationEvent)
					if (isRootStore(innerTarget)) {
						target.on.atomCreation.next(token)
					} else if (
						isChildStore(innerTarget) &&
						innerTarget.on.transactionApplying.state === null
					) {
						innerTarget.transactionMeta.update.subEvents.push(atomCreationEvent)
					}
					break
				case `writable_pure_selector`:
				case `writable_held_selector`:
					target.on.selectorCreation.next(token)
					break
			}
		}
		return /* bailing early here to avoid redundant update */
	}
	const { key, subject, type } = state

	let update: StateUpdate<T>
	if (hasOldValue) {
		update = {
			oldValue: isTransceiver(oldValue) ? oldValue.READONLY_VIEW : oldValue,
			newValue: isTransceiver(newValue) ? newValue.READONLY_VIEW : newValue,
		}
	} else {
		update = {
			newValue: isTransceiver(newValue) ? newValue.READONLY_VIEW : newValue,
		}
	}

	if (isRootStore(target)) {
		switch (type) {
			case `mutable_atom`:
				if (target.logger.isEnabled?.(`info`) !== false) {
					target.logger.info(
						`📢`,
						type,
						key,
						`is now (`,
						newValue,
						`) subscribers:`,
						subject.subscribers.keys(),
					)
				}
				break
			case `atom`:
			case `writable_pure_selector`:
			case `writable_held_selector`:
				if (target.logger.isEnabled?.(`info`) !== false) {
					target.logger.info(
						`📢`,
						type,
						key,
						`went (`,
						oldValue,
						`->`,
						newValue,
						`) subscribers:`,
						subject.subscribers.keys(),
					)
				}
		}
		subject.next(update)
	}

	if (isChildStore(target) && (type === `mutable_atom` || type === `atom`)) {
		if (target.on.transactionApplying.state === null) {
			if (isTransceiver(newValue)) {
				return
			}
			const { timestamp } = target.operation
			const atomUpdate: AtomUpdateEvent<any> = {
				type: `atom_update`,
				token,
				timestamp,
				update,
			}
			target.transactionMeta.update.subEvents.push(atomUpdate)
			if (target.logger.isEnabled?.(`info`) !== false) {
				target.logger.info(
					`📁`,
					`atom`,
					key,
					`stowed (`,
					oldValue,
					`->`,
					newValue,
					`)`,
				)
			}
			return
		}
		if (hasRole(state, `tracker:signal`)) {
			const keyOfMutable = key.slice(1)
			const mutable = target.atoms.get(keyOfMutable) as MutableAtom<
				Transceiver<any, any, any>
			>
			const transceiver = readOrComputeValue<Transceiver<any, any, any>, never>(
				target,
				mutable,
				`mut`,
			)
			const accepted = transceiver.do(update.newValue) === null
			if (accepted === true) {
				evictDownstreamFromAtom(target, mutable)
			}
		}
	}
}
