import type {
	TimelineEvent,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"

export const TIMELINE_TRANSACTION_GROUP: unique symbol = Symbol(
	`timelineTransactionGroup`,
)

let nextTimelineTransactionGroupSequence = 0
const timelineTransactionGroups = new WeakMap<
	TransactionOutcomeEvent<TransactionToken<any>>,
	TimelineTransactionGroup
>()

export type TimelineTransactionGroup = {
	sequence: number
	timelineKeys: Set<string>
}

export type GroupedTimelineTransactionEvent = TimelineEvent<any> &
	TransactionOutcomeEvent<TransactionToken<any>> & {
		[TIMELINE_TRANSACTION_GROUP]: TimelineTransactionGroup
	}

export function addTimelineToTransactionGroup(
	outcome: TransactionOutcomeEvent<TransactionToken<any>>,
	timelineKey: string,
): TimelineTransactionGroup {
	let group = timelineTransactionGroups.get(outcome)
	if (!group) {
		group = {
			sequence: nextTimelineTransactionGroupSequence++,
			timelineKeys: new Set(),
		}
		timelineTransactionGroups.set(outcome, group)
	}
	group.timelineKeys.add(timelineKey)
	return group
}

export function getTimelineTransactionGroup(
	event: TimelineEvent<any>,
): TimelineTransactionGroup | undefined {
	return (event as Partial<GroupedTimelineTransactionEvent>)[
		TIMELINE_TRANSACTION_GROUP
	]
}
