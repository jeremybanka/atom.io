import type {
	TimelineFamilyToken,
	TimelineManageable,
	TimelineToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

import { deposit, type Store } from "../store/index.ts"
import { seekTimelineInStore } from "./create-timeline-family.ts"

export function disposeTimelineInStore<M extends TimelineManageable>(
	store: Store,
	token: TimelineToken<M>,
): void
export function disposeTimelineInStore<
	K extends Canonical,
	M extends TimelineManageable,
>(store: Store, family: TimelineFamilyToken<K, M>, key: NoInfer<K>): void
export function disposeTimelineInStore<
	K extends Canonical,
	M extends TimelineManageable,
>(
	store: Store,
	...params:
		| [token: TimelineToken<M>]
		| [family: TimelineFamilyToken<K, M>, key: NoInfer<K>]
): void {
	const token =
		params.length === 1
			? params[0]
			: seekTimelineInStore(store, params[0], params[1])
	if (!token) {
		store.logger.error(
			`❌`,
			`timeline_family`,
			params[0].key,
			`Timeline family member could not be disposed because it was not found in store "${store.config.name}".`,
		)
		return
	}
	const timeline = store.timelines.get(token.key)
	if (!timeline) {
		store.logger.error(
			`❌`,
			`timeline`,
			token.key,
			`Could not be disposed because it was not found in store "${store.config.name}".`,
		)
		return
	}
	const deposited = deposit(timeline) as TimelineToken<M>
	for (const unsubscribe of timeline.subscriptions.values()) {
		unsubscribe()
	}
	timeline.subscriptions.clear()
	timeline.subject.subscribers.clear()
	timeline.history = []
	timeline.at = 0
	timeline.selectorTime = null
	timeline.transactionKey = null
	timeline.timeTraveling = null
	store.timelineTopics.delete(timeline.key)
	store.timelines.delete(timeline.key)
	store.on.timelineDisposal.next(deposited)
	store.logger.info(`🔥`, `timeline`, timeline.key, `disposed`)
}
