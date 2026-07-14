import type { ReadonlyPureSelectorFamilyToken } from "atom.io"
import { Subject } from "atom.io/foundations/subject"
import type { RootStore, Timeline } from "atom.io/internal"
import {
	createRegularAtomFamily,
	createSelectorFamily,
	disposeFromStore,
	seekInStore,
} from "atom.io/internal"

export const attachTimelineFamily = (
	store: RootStore,
): ReadonlyPureSelectorFamilyToken<Timeline<any>, string> => {
	const findTimelineLogState__INTERNAL = createRegularAtomFamily<
		Timeline<any>,
		string,
		never
	>(store, {
		key: `🔍 Timeline Update Log (Internal)`,
		default: (key) =>
			store.timelines.get(key) ?? {
				type: `timeline`,
				key: ``,
				at: 0,
				timeTraveling: null,
				history: [],
				selectorTime: null,
				transactionKey: null,
				ownedTopicKeys: new Set(),
				install: () => {},
				subject: new Subject(),
				subscriptions: new Map(),
			},
		effects: (key) => [
			({ setSelf }) => {
				const tl = store.timelines.get(key)
				tl?.subject.subscribe(`introspection`, (_) => {
					setSelf({ ...tl })
				})
			},
		],
	})
	const findTimelineLogState = createSelectorFamily<
		Timeline<any>,
		string,
		never
	>(store, {
		key: `🔍 Timeline Update Log`,
		get:
			(key) =>
			({ get }) =>
				get(findTimelineLogState__INTERNAL, key),
	})
	store.on.timelineDisposal.subscribe(
		`introspection:timeline-logs`,
		(timelineToken) => {
			const publicLog = seekInStore(
				store,
				findTimelineLogState,
				timelineToken.key,
			)
			if (publicLog) {
				disposeFromStore(store, publicLog)
			}
			const internalLog = seekInStore(
				store,
				findTimelineLogState__INTERNAL,
				timelineToken.key,
			)
			if (internalLog) {
				disposeFromStore(store, internalLog)
			}
		},
	)
	return findTimelineLogState
}
