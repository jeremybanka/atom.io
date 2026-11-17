/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { HighlightedText } from "./HighlightedText.tsx"
import type { SearchView as View } from "./search.ts"
import css from "./SearchControls.module.css"
import type { SearchPresentation } from "./SearchView.tsx"

export function SearchControls(props: {
	type: View
	state: SearchPresentation
}): SpaElement {
	const history = props.type === `transactions` || props.type === `timelines`
	const description = () => {
		const selected = props.state.selected!
		const document = selected.document
		return `${document.detail} · ${document.value === `copied` ? `Cached simple value copied` : document.value === `skipped` ? `Complex value skipped` : document.value === `family` ? `Registered family; no member created` : `Value not cached; no value searched`}`
	}
	return (
		<search-controls class={css.class}>
			<search-row>
				<input
					type="search"
					aria-label={`Search ${props.type}`}
					placeholder={
						history
							? `Search recorded ${props.type}`
							: `Search ${props.type} and cached values`
					}
				/>
				<button type="button" data-action="clear">
					Clear
				</button>
				<button type="button" data-action="refresh">
					Refresh
				</button>
			</search-row>
			<p data-search-status role="status">
				{props.state.message || (
					<>
						<strong>{props.state.summary}</strong>
						<span>{props.state.metadata}</span>
					</>
				)}
			</p>
			<details data-capture>
				<summary>Capture details</summary>
				<p>{props.state.notes}</p>
			</details>
			<p data-pinned>{props.state.pinned ? `Editing — kept visible` : ``}</p>
			<search-results
				role="list"
				aria-label={`${props.type} search results`}
				aria-busy={props.state.busy ? `true` : undefined}
			>
				{props.state.hits.map((hit) => (
					<li key={hit.document.id}>
						<button
							type="button"
							data-search-id={hit.document.id}
							data-active-result={
								props.state.selected?.document.id === hit.document.id
									? ``
									: undefined
							}
							title={hit.document.key}
							aria-label={
								history
									? `${hit.document.key} — ${hit.document.detail}`
									: hit.document.key
							}
						>
							{<HighlightedText text={hit.document.label} ranges={hit.ranges} />}
						</button>
						<small>
							{history ? hit.document.detail : ``}
							{hit.valueMatch ? (
								<>
									{history ? ` · recorded value: ` : `cached value: `}
									{
										<HighlightedText
											text={hit.valueField!.text}
											ranges={hit.valueRanges}
										/>
									}
								</>
							) : (
								``
							)}
							{hit.approximate ? ` · approximate match` : ``}
						</small>
					</li>
				))}
			</search-results>
			<search-details hidden={!props.state.detail && !props.state.selected}>
				{props.state.detail ||
					(props.state.selected ? (
						<>
							<h2>{props.state.selected.document.key}</h2>
							<p>{description()}</p>
							{props.state.selected.document.kind !== `family` ? (
								<button type="button" data-action="open-live">
									{props.state.existing
										? `Return to live editor`
										: `Open live editor (may read/evaluate)`}
								</button>
							) : null}
						</>
					) : null)}
			</search-details>
		</search-controls>
	)
}
