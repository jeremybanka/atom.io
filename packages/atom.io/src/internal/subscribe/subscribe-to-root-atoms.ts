import { readOrComputeValue } from "../get-state/read-or-compute-value.ts"
import {
	deferSelectorNotification,
	hasStateNotificationBatch,
} from "../state-notification-batch.ts"
import type { Atom, Selector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { notifySubjectSubscribers } from "../transaction/transaction-observer-errors.ts"
import { recallState } from "./recall-state.ts"
import { reconcileSelectorRootSubscriptions } from "./selector-root-subscriptions.ts"

export function subscribeToRootDependency(
	target: Store,
	selector: Selector<any, any>,
	atom: Atom<any, any>,
): () => void {
	return atom.subject.subscribe(
		`${selector.type}:${selector.key}`,
		(atomChange) => {
			if (hasStateNotificationBatch(target)) {
				deferSelectorNotification(target, selector.key, () => {
					notifySelectorUpdate(target, selector, atom, atomChange)
				})
				return
			}
			notifySelectorUpdate(target, selector, atom, atomChange)
		},
	)
}

function notifySelectorUpdate(
	target: Store,
	selector: Selector<any, any>,
	atom: Atom<any, any>,
	atomChange: { oldValue?: any; newValue: any },
): void {
	target.logger.info(
		`📢`,
		selector.type,
		selector.key,
		`root`,
		atom.key,
		`went`,
		atomChange.oldValue,
		`->`,
		atomChange.newValue,
	)
	try {
		const oldValue = recallState(target, selector)
		const newValue = readOrComputeValue(target, selector)
		target.logger.info(
			`✨`,
			selector.type,
			selector.key,
			`went`,
			oldValue,
			`->`,
			newValue,
		)
		notifySubjectSubscribers(selector.subject, { newValue, oldValue })
	} catch (thrown) {
		reconcileSelectorRootSubscriptions(selector)
		throw thrown
	}
}
