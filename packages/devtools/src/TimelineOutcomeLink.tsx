/** @jsxImportSource @atom.io/spa */
import { type SpaElement, useSetter } from "@atom.io/spa"

import {
	compactOutcomePath,
	historyGraphId,
	historyIdentity,
	historyOutcomeSequence,
	type RecordedEvent,
} from "./history-event.ts"
import { type EditorTools, useExpanded } from "./store.ts"
import css from "./TimelineOutcomeLink.module.css"

type Outcome = Extract<RecordedEvent, { type: `transaction_outcome` }>

export function TimelineOutcomeLink(props: {
	tools: EditorTools
	event: Outcome
	timelineKey: string
	navigate?: ((owner: string, outcome: string) => boolean) | undefined
	render(outcome: Outcome, index: number): SpaElement
}): SpaElement {
	const setExpanded = useSetter(props.tools.expanded)
	const outcomeLog = props.tools.history.useTransaction(props.event.token.key)
	const sequence = historyOutcomeSequence(props.event)
	const sourceIndex = () =>
		sequence === undefined
			? -1
			: outcomeLog().findIndex(
					(event) => historyOutcomeSequence(event) === sequence,
				)
	const [open, toggle] = useExpanded(props.tools, [
		`timeline-source`,
		props.timelineKey,
		historyIdentity(props.event),
	])
	const follow = (event: MouseEvent, source: Outcome) => {
		const owner = `transaction:${source.token.key}`
		const identity = historyIdentity(source)
		if (props.navigate?.(owner, historyGraphId(owner, identity))) {
			setExpanded((previous) => ({
				...previous,
				[JSON.stringify(compactOutcomePath(identity))]: true,
			}))
		} else toggle(event)
	}
	const content = () => {
		const index = sourceIndex()
		const source = outcomeLog()[index]
		return (
			source && (
				<>
					<button
						type="button"
						aria-expanded={props.navigate && !open() ? undefined : open()}
						onClick={(event) => {
							follow(event, source)
						}}
					>
						{open() ? `Hide outcome` : `View outcome`}
					</button>
					{open() && props.render(source, index)}
				</>
			)
		)
	}
	return (
		<timeline-outcome-link class={css.class}>{content()}</timeline-outcome-link>
	)
}
