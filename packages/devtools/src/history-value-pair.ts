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
	if (typeof before !== `string` || typeof after !== `string`) return undefined
	if (!/["\\\r\n\t]/.test(before) && !/["\\\r\n\t]/.test(after)) return undefined
	const previous = describeOutcomeValue(before)
	const next = describeOutcomeValue(after)
	return {
		before: { value: before, preview: previous.text },
		after: { value: after, preview: next.text },
	}
}
