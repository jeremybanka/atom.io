/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import css from "./EcologySearch.module.css"
import type { EcologyPresentation } from "./EcologyView.tsx"
import { HighlightedText } from "./HighlightedText.tsx"

export function EcologySearch(props: {
	marker: string
	state: EcologyPresentation
}): SpaElement {
	return (
		<ecology-search class={css.class}>
			<dialog
				id={`${props.marker}-search`}
				data-search-modal
				aria-label="Search ecology"
				aria-modal={props.state.dialog === `search` ? `true` : undefined}
			>
				<search-heading>
					<h2>Search ecology</h2>
					<button
						type="button"
						data-action="close-dialog"
						aria-label="Close search"
						title="Close search"
					>
						×
					</button>
				</search-heading>
				<form role="search">
					<input
						type="search"
						aria-label="Search ecology"
						placeholder="Search keys, families, types"
					/>
					<button
						type="button"
						data-action="clear-query"
						aria-label="Clear search"
						title="Clear search"
					>
						×
					</button>
				</form>
				<p
					data-search-status
					role="status"
					hidden={!props.state.query.trim() && !props.state.busy}
				>
					{props.state.status}
				</p>
				<ol
					data-results
					aria-label="ecology search results"
					aria-busy={props.state.busy ? `true` : undefined}
				>
					{props.state.hits.map((hit) => (
						<li key={hit.document.id}>
							<button
								type="button"
								data-action="result"
								data-result-id={hit.document.id}
								aria-label={hit.document.key}
							>
								<HighlightedText text={hit.document.label} ranges={hit.ranges} />
							</button>
							<small>
								{hit.document.detail}
								{hit.approximate ? ` · approximate match` : ``}
							</small>
						</li>
					))}
				</ol>
			</dialog>
		</ecology-search>
	)
}
