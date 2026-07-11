import type { TransactionSubEvent } from "atom.io"

import type { Store } from "../store/index.ts"

export function partitionTransactionSubEvents(
	store: Store,
	updates: TransactionSubEvent[],
	participantTimelineKeys: ReadonlySet<string>,
): Map<string, TransactionSubEvent[]> {
	const partitions = new Map<string, TransactionSubEvent[]>()

	for (const update of updates) {
		switch (update.type) {
			case `transaction_outcome`: {
				const nestedPartitions = partitionTransactionSubEvents(
					store,
					update.subEvents,
					participantTimelineKeys,
				)
				for (const timelineKey of participantTimelineKeys) {
					const subEvents =
						nestedPartitions.get(timelineKey) ??
						(update.subEvents.length === 0 ? update.subEvents : [])
					appendToPartition(
						partitions,
						timelineKey,
						subEvents === update.subEvents ? update : { ...update, subEvents },
					)
				}
				break
			}
			case `molecule_creation`:
			case `molecule_disposal`:
			case `molecule_transfer`:
				for (const timelineKey of participantTimelineKeys) {
					appendToPartition(partitions, timelineKey, update)
				}
				break
			case `atom_creation`:
			case `atom_disposal`:
			case `atom_update`: {
				const directTimelineKey = store.timelineTopics.getRelatedKey(
					update.token.key,
				)
				if (
					directTimelineKey !== undefined &&
					participantTimelineKeys.has(directTimelineKey)
				) {
					appendToPartition(partitions, directTimelineKey, update)
				}

				const familyKey = update.token.family?.key
				if (familyKey === undefined) break
				const familyTimelineKey = store.timelineTopics.getRelatedKey(familyKey)
				if (
					familyTimelineKey !== undefined &&
					familyTimelineKey !== directTimelineKey &&
					participantTimelineKeys.has(familyTimelineKey)
				) {
					appendToPartition(partitions, familyTimelineKey, update)
				}
				break
			}
		}
	}

	for (const [timelineKey, partition] of partitions) {
		if (isUnchangedPartition(updates, partition)) {
			partitions.set(timelineKey, updates)
		}
	}

	return partitions
}

function appendToPartition(
	partitions: Map<string, TransactionSubEvent[]>,
	timelineKey: string,
	update: TransactionSubEvent,
): void {
	const partition = partitions.get(timelineKey)
	if (partition === undefined) {
		partitions.set(timelineKey, [update])
	} else {
		partition.push(update)
	}
}

function isUnchangedPartition(
	updates: TransactionSubEvent[],
	partition: TransactionSubEvent[],
): boolean {
	if (updates.length !== partition.length) return false
	for (let index = 0; index < updates.length; ++index) {
		if (updates[index] !== partition[index]) return false
	}
	return true
}
