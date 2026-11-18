/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import css from "./EcologyGuide.module.css"

export function EcologyGuide(props: {
	marker: string
	notice: string
}): SpaElement {
	return (
		<ecology-guide class={css.class}>
			<dialog
				id={`${props.marker}-guide`}
				data-guide-modal
				aria-modal="true"
				aria-labelledby={`${props.marker}-guide-title`}
			>
				<guide-heading>
					<h2 id={`${props.marker}-guide-title`}>Ecology guide</h2>
					<button
						type="button"
						data-action="close-dialog"
						aria-label="Close guide"
						title="Close guide"
					>
						×
					</button>
				</guide-heading>
				<article tabIndex={0} aria-label="Ecology user guide">
					<h3>Navigate the graph</h3>
					<p>
						Drag to orbit, right-drag to pan, and scroll to zoom. On touch
						screens, use one finger to orbit and two fingers to pan or pinch to
						zoom. Focus the graph and use arrow keys to pan, or + and − to zoom.
						Fit shows the painted graph; Reset view restores the starting camera.
					</p>
					<h3>Selection and families</h3>
					<p>
						Select a card or an editor row to follow its captured graph. Stronger
						edges and cards show its upstream and downstream paths. Unrelated
						cards fade, and the selected card stays in front. Escape clears
						selection. Enter on a selected family or family member toggles
						clustering and expansion along the cylinder tangent.
					</p>
					<p>
						The ecology editor stays beside the graph on wide screens and below
						it on narrow screens. Selected, related and other nodes have separate
						sections. Cached values have nested editors; Generate explicitly
						reads a missing value and can evaluate a default or selector. Node
						details retain dependency information and root tracing. Show more
						nodes admits additional rows.
					</p>
					<h3>Search and filter</h3>
					<p>
						Search keys, families, member subkeys and captured types. Use
						Ctrl/Cmd+Shift+F, or / outside an editor, to focus search. Arrow keys
						visit ranked matches; Enter selects one. On narrow views, the search
						button opens a modal and its colored dot means a filter is active.
						Closing the modal keeps the filter. Search filters editor rows while
						other cards stay compact and faded on the canvas. Clear search
						restores full cards. Unfinished edits stay mounted, with an
						outside-filter marker when needed.
					</p>
					<h3>Capture details &amp; legend</h3>
					<p data-notice>{props.notice}</p>
					<p>
						Atom and Selector cards represent captured state. Dashed cards group
						families, including empty definitions. Arrows point from a dependency
						to its consumer. Each key gives its card border and outgoing arrows a
						stable color: warm hues for atoms, cool hues for selectors. Members
						share their family's color. Clustered members sit slightly around
						their family center, keeping separate edges that overlap into a band
						with a darker core and softer fringe. The parallel springs stay
						opposite at equal height; their viewer-facing cards can still overlap
						in projection.
					</p>
					<p>
						Capture happens on entry and Refresh. Searching, selecting, tracing
						and expanding families never evaluate application state. Primitive
						card previews come from the cache; opaque values use shallow markers.
						Observed dependencies can be stale, incomplete or truncated. Search
						covers only captured metadata; full store totals are unknown after a
						truncated capture. Generate reads or evaluates a state. Expanding
						object properties and changing editor values are explicit
						interactions.
					</p>
				</article>
			</dialog>
		</ecology-guide>
	)
}
