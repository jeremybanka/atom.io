/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EcologySearch } from "./EcologySearch.tsx"
import css from "./EcologyToolbar.module.css"
import type { EcologyPresentation } from "./EcologyView.tsx"

export function EcologyToolbar(props: {
	marker: string
	state: EcologyPresentation
}): SpaElement {
	return (
		<ecology-toolbar class={css.class}>
			<EcologySearch marker={props.marker} state={props.state} />
			<button
				type="button"
				data-action="search"
				data-filtered={props.state.filtered}
				aria-label={
					props.state.filtered
						? `Search ecology (filter active)`
						: `Search ecology`
				}
				title={
					props.state.filtered
						? `Search ecology — filter active`
						: `Search ecology`
				}
				aria-haspopup="dialog"
				aria-controls={`${props.marker}-search`}
				aria-expanded={props.state.dialog === `search`}
			>
				<svg
					viewBox="0 0 16 16"
					width="16"
					height="16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<circle cx="7" cy="7" r="4.5" />
					<path d="m10.5 10.5 3.5 3.5" />
				</svg>
			</button>
			<ecology-actions role="group" aria-label="Ecology actions">
				{[
					[`refresh`, `Refresh`, `M13 6A5 5 0 1 0 13 10M13 2v4H9`],
					[
						`clear`,
						`Clear selection`,
						`M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M6 6l4 4m0-4-4 4`,
					],
					[`fit`, `Fit`, `M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4`],
					[`reset`, `Reset view`, `m2 7 6-5 6 5M4 6v8h8V6`],
					[
						`guide`,
						`Ecology guide`,
						`M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12M8 7v4M8 4.5v.1`,
					],
				].map(([action, label, path]) => (
					<button
						key={action}
						type="button"
						data-action={action}
						aria-label={label}
						title={label}
						aria-haspopup={action === `guide` ? `dialog` : undefined}
						aria-controls={
							action === `guide` ? `${props.marker}-guide` : undefined
						}
						aria-expanded={
							action === `guide` ? props.state.dialog === `guide` : undefined
						}
					>
						<svg
							viewBox="0 0 16 16"
							width="16"
							height="16"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d={path} />
						</svg>
					</button>
				))}
			</ecology-actions>
		</ecology-toolbar>
	)
}
