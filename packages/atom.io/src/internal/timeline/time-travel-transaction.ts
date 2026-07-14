import type {
	TimelineUpdate,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"

import { ingestTransactionOutcomeEvent } from "../events/index.ts"
import type { Store } from "../store/index.ts"
import type { Timeline } from "./create-timeline.ts"
import type { TimelineTransactionGroup } from "./timeline-transaction-group.ts"
import { getTimelineTransactionGroup } from "./timeline-transaction-group.ts"

type TransactionTimeTravel = `redo` | `undo`

type Participant = {
	event: TransactionOutcomeEvent<TransactionToken<any>>
	eventIndex: number
	timeline: Timeline<any>
}

export function timeTravelTransactionInStore(
	store: Store,
	action: TransactionTimeTravel,
	token: TransactionToken<any>,
	id?: string,
): void {
	if (store.on.transactionApplying.state !== null) {
		store.logger.error(
			`❌`,
			`transaction`,
			token.key,
			`Could not ${action} a transaction while another transaction is still applying.`,
		)
		return
	}
	const groups = findTransactionGroups(store, action, token, id)
	for (const group of groups) {
		if (timeTravelTransactionGroupInStore(store, action, group)) {
			return
		}
	}
	store.logger.warn(
		`💁`,
		`transaction`,
		token.key,
		`There is no transaction${id ? ` "${id}"` : ``} available to ${action}.`,
	)
}

export function timeTravelTransactionGroupInStore(
	store: Store,
	action: TransactionTimeTravel,
	group: TimelineTransactionGroup,
): boolean {
	const participants = findParticipantsAtHead(store, action, group)
	if (participants.length === 0) {
		return false
	}
	const applying = action === `redo` ? `newValue` : `oldValue`
	const timeTraveling = action === `redo` ? `into_future` : `into_past`
	for (const { eventIndex, timeline } of participants) {
		timeline.timeTraveling = timeTraveling
		timeline.at = action === `redo` ? eventIndex + 1 : eventIndex
	}
	try {
		for (const { event } of participants) {
			ingestTransactionOutcomeEvent(store, event, applying)
		}
	} finally {
		for (const { timeline } of participants) {
			timeline.timeTraveling = null
		}
	}
	for (const { timeline } of participants) {
		const update: TimelineUpdate<any> = {
			type: `timeline_update`,
			event: action,
			at: timeline.at,
			length: timeline.history.length,
		}
		timeline.subject.next(update)
	}
	return true
}

export function getTimelineTransactionAtHead(
	timeline: Timeline<any>,
	action: TransactionTimeTravel,
): TimelineTransactionGroup | undefined {
	const eventIndex = action === `redo` ? timeline.at : timeline.at - 1
	if (eventIndex < 0 || eventIndex >= timeline.history.length) {
		return undefined
	}
	const event = timeline.history[eventIndex]
	if (event?.type !== `transaction_outcome`) {
		return undefined
	}
	return getTimelineTransactionGroup(event)
}

function findTransactionGroups(
	store: Store,
	action: TransactionTimeTravel,
	token: TransactionToken<any>,
	id?: string,
): TimelineTransactionGroup[] {
	const groups = new Set<TimelineTransactionGroup>()
	for (const timeline of store.timelines.values()) {
		for (const event of timeline.history) {
			if (
				event.type !== `transaction_outcome` ||
				event.token.key !== token.key ||
				(id !== undefined && event.id !== id)
			) {
				continue
			}
			const group = getTimelineTransactionGroup(event)
			if (group) {
				groups.add(group)
			}
		}
	}
	return [...groups].sort((a, b) =>
		action === `undo` ? b.sequence - a.sequence : a.sequence - b.sequence,
	)
}

function findParticipantsAtHead(
	store: Store,
	action: TransactionTimeTravel,
	group: TimelineTransactionGroup,
): Participant[] {
	const participants: Participant[] = []
	for (const timelineKey of group.timelineKeys) {
		const timeline = store.timelines.get(timelineKey)
		if (!timeline) {
			continue
		}
		const eventIndex = timeline.history.findIndex(
			(event) => getTimelineTransactionGroup(event) === group,
		)
		if (eventIndex === -1) {
			continue
		}
		const atHead =
			action === `undo`
				? timeline.at === eventIndex + 1
				: timeline.at === eventIndex
		const event = timeline.history[eventIndex]
		if (!atHead || event.type !== `transaction_outcome`) {
			continue
		}
		participants.push({ event, eventIndex, timeline })
	}
	return participants
}
