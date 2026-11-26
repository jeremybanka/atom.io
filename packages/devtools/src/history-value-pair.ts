import { describeOutcomeValue } from "./history-value.ts"

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
	if (typeof before !== `string` || typeof after !== `string`) return undefined
	if (!/["\\\r\n\t]/.test(before) && !/["\\\r\n\t]/.test(after)) return undefined
	const previous = describeOutcomeValue(before)
	const next = describeOutcomeValue(after)
	return {
		before: { value: before, preview: previous.text },
		after: { value: after, preview: next.text },
	}
}
