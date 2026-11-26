import { describeOutcomeValue, historySnapshotShape } from "./history-value.ts"

type Snapshot = { value: unknown; preview: string; description?: string }

export type HistoryValuePair = {
	before: Snapshot
	after: Snapshot
	disclose?: boolean
}

function dateSnapshot(value: unknown): string | undefined {
	try {
		if (!(value instanceof Date)) return undefined
		return Number.isNaN(Date.prototype.getTime.call(value))
			? `Invalid`
			: Date.prototype.toISOString.call(value)
	} catch {
		return undefined
	}
}

function textChange(before: string, after: string): HistoryValuePair {
	let prefix = 0
	const maxPrefix = Math.min(before.length, after.length, 16_384)
	while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++
	const roughStart = Math.max(0, prefix - 8)
	const space = roughStart ? before.indexOf(` `, roughStart) : -1
	const start = space >= roughStart && space < prefix ? space + 1 : roughStart
	const preview = (value: string) => {
		const limit = Math.min(value.length, start + 44)
		const spaceBeforeLimit =
			limit < value.length ? value.lastIndexOf(` `, limit) : -1
		const end = spaceBeforeLimit > start + 30 ? spaceBeforeLimit : limit
		return `${start ? `…` : ``}${JSON.stringify(value.slice(start, end))}${value.length > end ? `…` : ``}`
	}
	return {
		before: { value: before, preview: preview(before) },
		after: { value: after, preview: preview(after) },
		disclose: true,
	}
}

function typedSnapshot(value: unknown, description: string): Snapshot {
	return { value, description, preview: describeOutcomeValue(value).text }
}

export function historyValuePair(
	before: unknown,
	after: unknown,
): HistoryValuePair | undefined {
	if (typeof before === `bigint` && typeof after === `bigint`) {
		const previous = `${before}n`,
			next = `${after}n`
		if (Math.max(previous.length, next.length) >= 10) {
			const digits = (value: string) =>
				value.length > 36 ? `${value.slice(0, 12)}…${value.slice(-22)}` : value
			return {
				before: { value: before, preview: digits(previous) },
				after: { value: after, preview: digits(next) },
				disclose: Math.max(previous.length, next.length) > 36,
			}
		}
	}
	const beforeDate = dateSnapshot(before)
	const afterDate =
		typeof beforeDate === `string` ? dateSnapshot(after) : undefined
	if (beforeDate && afterDate) {
		const separator = beforeDate.indexOf(`T`)
		const sameTime =
			separator !== -1 && afterDate.endsWith(beforeDate.slice(separator))
		const preview = (iso: string) =>
			sameTime ? iso.slice(0, iso.indexOf(`T`)) : iso
		return {
			before: {
				value: before,
				preview: preview(beforeDate),
				description: `Date`,
			},
			after: { value: after, preview: preview(afterDate), description: `Date` },
			disclose: sameTime,
		}
	}
	const oldShape = historySnapshotShape(before)
	const newShape = historySnapshotShape(after)
	if (
		oldShape?.kind !== newShape?.kind &&
		(oldShape?.kind === `Array` ||
			newShape?.kind === `Array` ||
			(oldShape && newShape))
	) {
		return {
			before: typedSnapshot(
				before,
				oldShape?.description ?? (before === null ? `null` : typeof before),
			),
			after: typedSnapshot(
				after,
				newShape?.description ?? (after === null ? `null` : typeof after),
			),
			disclose: true,
		}
	}
	if (typeof before !== `string` || typeof after !== `string`) return undefined
	if (Math.max(before.length, after.length) > 42)
		return textChange(before, after)
	if (!/["\\\r\n\t]/.test(before) && !/["\\\r\n\t]/.test(after)) return undefined
	const previous = describeOutcomeValue(before)
	const next = describeOutcomeValue(after)
	return {
		before: { value: before, preview: previous.text },
		after: { value: after, preview: next.text },
	}
}
