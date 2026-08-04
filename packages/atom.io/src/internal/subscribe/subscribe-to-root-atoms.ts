import { readOrComputeValue } from "../get-state/read-or-compute-value.ts"
import type { Atom, Selector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import {
	deferTransactionSelectorNotification,
	notifyTransactionSubject,
} from "../transaction/transaction-notification-batch.ts"
import { recallState } from "./recall-state.ts"

export function subscribeToRootDependency(
	target: Store,
	selector: Selector<any, any>,
	atom: Atom<any, any>,
): () => void {
	return atom.subject.subscribe(
		`${selector.type}:${selector.key}`,
		(atomChange) => {
			if (
				deferTransactionSelectorNotification(target, selector.key, () => {
					notifySelectorUpdate(target, selector, atom, atomChange)
				})
			) {
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
	notifyTransactionSubject(target, selector.subject, { newValue, oldValue })
}
