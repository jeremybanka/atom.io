import { readOrComputeValue } from "../get-state/read-or-compute-value.ts"
import type { Atom, Selector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import {
	deferTransactionSelectorNotification,
	notifyTransactionSubject,
} from "../transaction/transaction-notification-batch.ts"
import { recallState } from "./recall-state.ts"

type RootDependencySubscription = {
	consumers: number
	unsubscribe: () => void
}

// Consumers share each upstream listener until its last subscription is released.
const rootDependencySubscriptions = new WeakMap<
	Store,
	WeakMap<
		Selector<any, any>,
		WeakMap<Atom<any, any>, RootDependencySubscription>
	>
>()
let subscriptionId = 0

export function subscribeToRootDependency(
	target: Store,
	selector: Selector<any, any>,
	atom: Atom<any, any>,
): () => void {
	let selectors = rootDependencySubscriptions.get(target)
	if (!selectors) {
		selectors = new WeakMap()
		rootDependencySubscriptions.set(target, selectors)
	}
	let roots = selectors.get(selector)
	if (!roots) {
		roots = new WeakMap()
		selectors.set(selector, roots)
	}
	let subscription = roots.get(atom)
	if (!subscription) {
		subscription = {
			consumers: 0,
			unsubscribe: atom.subject.subscribe(
				`${selector.type}:${selector.key}:${subscriptionId++}`,
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
			),
		}
		roots.set(atom, subscription)
	}
	subscription.consumers++
	const retained = subscription
	const dependencies = roots
	let active = true
	return () => {
		if (!active) return
		active = false
		if (--retained.consumers === 0) {
			retained.unsubscribe()
			dependencies.delete(atom)
		}
	}
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
