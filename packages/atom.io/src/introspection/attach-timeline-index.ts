import type { AtomToken, TimelineToken } from "atom.io"
import type { Store } from "atom.io/internal"
import { createRegularAtom, deposit } from "atom.io/internal"

export const attachTimelineIndex = (
	store: Store,
): AtomToken<TimelineToken<any>[]> => {
	return createRegularAtom<TimelineToken<any>[], never, never>(
		store,
		{
			key: `🔍 Timeline Token Index`,
			default: (): TimelineToken<any>[] =>
				[...store.timelines.values()].map(
					(timeline): TimelineToken<any> => deposit(timeline),
				),
			effects: [
				({ setSelf }) => {
					store.on.timelineCreation.subscribe(
						`introspection`,
						(timelineToken) => {
							setSelf((state) => [...state, timelineToken])
						},
					)
					store.on.timelineDisposal.subscribe(
						`introspection`,
						(timelineToken) => {
							setSelf((state) =>
								state.filter((token) => token.key !== timelineToken.key),
							)
						},
					)
				},
			],
		},
		undefined,
	)
}
