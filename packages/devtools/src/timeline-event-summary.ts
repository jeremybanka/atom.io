import { historyValue, type RecordedEvent } from "./history-event.ts"
import {
	historyCollectionChanges,
	historySnapshotShape,
} from "./history-value.ts"

type TimelineEventSummary =
	| string
	| { before: string; after: string; label?: string }

const valueLimit = 18

function shortValue(value: unknown): string | undefined {
	if (typeof value === `string` && value.length > valueLimit) return
	const text = Object.is(value, -0) ? `-0` : historyValue(value, valueLimit)
	if (text !== undefined && text.length <= valueLimit) return text
}

function updateSummary(before: unknown, after: unknown): TimelineEventSummary {
	const previous = shortValue(before)
	const next = shortValue(after)
	if (
		previous !== undefined &&
		next !== undefined &&
		previous.length + next.length <= valueLimit
	)
		return { before: previous, after: next }
	if (typeof before === `string` && typeof after === `string`)
		return before.length === after.length
			? `Text changed`
			: {
					label: `length`,
					before: String(before.length),
					after: String(after.length),
				}

	const oldShape = historySnapshotShape(before)
	const newShape = historySnapshotShape(after)
	if (!oldShape || !newShape || oldShape.kind !== newShape.kind) {
		if (!oldShape && !newShape) return `Value changed`
		return {
			before: oldShape?.kind ?? previous ?? typeof before,
			after: newShape?.kind ?? next ?? typeof after,
		}
	}

	const { kind } = oldShape
	if (oldShape.size !== newShape.size)
		return {
			label: kind === `Array` ? `length` : `size`,
			before: String(oldShape.size),
			after: String(newShape.size),
		}
	// Use the full comparison only when both snapshots fit its small sample.
	if (oldShape.truncated || newShape.truncated) return `${kind} changed`
	const comparison = historyCollectionChanges(before, after)
	if (!comparison) return `${kind} changed`

	const edits = comparison.entries.filter((entry) => entry.changed)
	const count = comparison.changeCount ?? edits.length
	if (count === 0)
		return comparison.orderChanged ? `Order changed` : `No visible change`
	if (count === 1) {
		const [entry] = edits
		if (kind === `Array`) return `Index ${entry.label} changed`
		if (kind === `Object`) {
			if (!entry.before) return `+ ${entry.label}`
			if (!entry.after) return `− ${entry.label}`
			return `${entry.label} changed`
		}
		return `1 entry changed`
	}
	const units =
		kind === `Array` ? `indexes` : kind === `Object` ? `fields` : `entries`
	return `${count} ${units} changed`
}

export function timelineEventSummary(
	event: RecordedEvent,
	writeCount: number | undefined,
): TimelineEventSummary | undefined {
	if (`update` in event)
		return updateSummary(event.update.oldValue, event.update.newValue)
	if (`value` in event)
		return (
			shortValue(event.value) ??
			historySnapshotShape(event.value)?.description ??
			`Value recorded`
		)
	if (writeCount === undefined || !(`subEvents` in event)) return

	const [child] = event.subEvents
	if (event.subEvents.length === 1 && `update` in child) {
		const summary = updateSummary(child.update.oldValue, child.update.newValue)
		const state = child.token.key
		return typeof summary === `string`
			? `${state} · ${summary}`
			: {
					...summary,
					label: summary.label ? `${state} · ${summary.label}` : state,
				}
	}
	return `${writeCount} ${writeCount === 1 ? `write` : `writes`}`
}
