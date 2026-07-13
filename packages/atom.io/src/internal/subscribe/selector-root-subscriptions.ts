import type { Selector } from "../state-types.ts"

type RootSubscriptionReconciler = () => void

const rootSubscriptionReconcilers = new WeakMap<
	Selector<any, any>,
	Set<RootSubscriptionReconciler>
>()

export function registerSelectorRootSubscriptionReconciler(
	selector: Selector<any, any>,
	reconcile: RootSubscriptionReconciler,
): () => void {
	let reconcilers = rootSubscriptionReconcilers.get(selector)
	if (!reconcilers) {
		reconcilers = new Set()
		rootSubscriptionReconcilers.set(selector, reconcilers)
	}
	reconcilers.add(reconcile)

	return () => {
		reconcilers.delete(reconcile)
		if (reconcilers.size === 0) {
			rootSubscriptionReconcilers.delete(selector)
		}
	}
}

export function reconcileSelectorRootSubscriptions(
	selector: Selector<any, any>,
): void {
	for (const reconcile of rootSubscriptionReconcilers.get(selector)!) {
		reconcile()
	}
}
