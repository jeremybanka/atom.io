import type {
	AtomToken,
	Loadable,
	ReadonlyPureSelectorFamilyToken,
	TimelineToken,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"
import type { Fn, RootStore, Timeline } from "atom.io/internal"

import { type AtomTokenIndex, attachAtomIndex } from "./attach-atom-index.ts"
import type { SelectorTokenIndex } from "./attach-selector-index.ts"
import { attachSelectorIndex } from "./attach-selector-index.ts"
import { attachTimelineFamily } from "./attach-timeline-family.ts"
import { attachTimelineIndex } from "./attach-timeline-index.ts"
import { attachTransactionIndex } from "./attach-transaction-index.ts"
import { attachTransactionLogs } from "./attach-transaction-logs.ts"
import { attachTypeSelectors } from "./attach-type-selectors.ts"

export type IntrospectionStates = {
	atomIndex: AtomToken<AtomTokenIndex>
	selectorIndex: AtomToken<SelectorTokenIndex>
	transactionIndex: AtomToken<TransactionToken<Fn>[]>
	transactionLogSelectors: ReadonlyPureSelectorFamilyToken<
		readonly TransactionOutcomeEvent<TransactionToken<Fn>>[],
		string
	>
	timelineIndex: AtomToken<TimelineToken<any>[]>
	timelineSelectors: ReadonlyPureSelectorFamilyToken<Timeline<any>, string>
	typeSelectors: ReadonlyPureSelectorFamilyToken<Loadable<string>, string>
}

export const attachIntrospectionStates = (
	store: RootStore,
): IntrospectionStates => {
	return {
		atomIndex: attachAtomIndex(store),
		selectorIndex: attachSelectorIndex(store),
		transactionIndex: attachTransactionIndex(store),
		transactionLogSelectors: attachTransactionLogs(store),
		timelineIndex: attachTimelineIndex(store),
		timelineSelectors: attachTimelineFamily(store),
		typeSelectors: attachTypeSelectors(store),
	}
}
