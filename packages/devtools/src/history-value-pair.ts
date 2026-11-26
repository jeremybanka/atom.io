import { describeOutcomeValue } from "./history-value.ts"

type Snapshot = { value: unknown; preview: string; description?: string }

export type HistoryValuePair = {
	before: Snapshot
	after: Snapshot
	disclose?: boolean
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
	if (typeof before !== `string` || typeof after !== `string`) return undefined
	if (!/["\\\r\n\t]/.test(before) && !/["\\\r\n\t]/.test(after)) return undefined
	const previous = describeOutcomeValue(before)
	const next = describeOutcomeValue(after)
	return {
		before: { value: before, preview: previous.text },
		after: { value: after, preview: next.text },
	}
}
