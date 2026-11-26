import { useSetter } from "@atom.io/spa"

import {
	compactOutcomePath,
	historyGraphId,
	historyIdentity,
	historyOutcomeSequence,
	type RecordedEvent,
} from "./history-event.ts"
import { type EditorTools, useExpanded } from "./store.ts"

type Outcome = Extract<RecordedEvent, { type: `transaction_outcome` }>

export function useTimelineOutcomeLink(props: {
	tools: EditorTools
	event: Outcome
	timelineKey: string
	navigate?: ((owner: string, outcome: string) => boolean) | undefined
}): {
	source(): { event: Outcome; index: number } | undefined
	open(): boolean
	follow(event: MouseEvent, original: Outcome): void
} {
	const setExpanded = useSetter(props.tools.expanded)
	const outcomeLog = props.tools.history.useTransaction(props.event.token.key)
	const sequence = historyOutcomeSequence(props.event)
	const source = () => {
		if (sequence === undefined) return
		const log = outcomeLog()
		const index = log.findIndex(
			(event) => historyOutcomeSequence(event) === sequence,
		)
		if (index >= 0) return { event: log[index], index }
	}
	const [open, toggle] = useExpanded(props.tools, [
		`timeline-source`,
		props.timelineKey,
		historyIdentity(props.event),
	])
	const follow = (event: MouseEvent, original: Outcome) => {
		const owner = `transaction:${original.token.key}`
		const identity = historyIdentity(original)
		if (props.navigate?.(owner, historyGraphId(owner, identity))) {
			setExpanded((previous) => ({
				...previous,
				[JSON.stringify(compactOutcomePath(identity))]: true,
			}))
		} else toggle(event)
	}
	return { source, open, follow }
}
