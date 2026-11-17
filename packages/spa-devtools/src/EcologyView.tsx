/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onCommit, onMount, useId } from "@atom.io/spa"
import { deposit } from "atom.io/internal"

import { createEcologyController } from "./ecology-controller.ts"
import type { GraphContext, GraphModel } from "./ecology-graph.ts"
import css from "./EcologyView.module.css"
import { HighlightedText } from "./HighlightedText.tsx"
import type { SearchHit } from "./search.ts"
import { StateLeaf } from "./StateLeaf.tsx"
import { type Tools, usePresentation } from "./store.ts"

export interface EcologyPresentation {
	cardSlots: number
	edgeSlots: number
	visibleCards: number
	visibleEdges: number
	cards: GraphModel[`items`]
	edges: { path: string; traced: boolean }[]
	selected?: GraphModel[`items`][number] | undefined
	selectionOutside: boolean
	counts: string
	notice: string
	status: string
	truncated: boolean
	hits: SearchHit[]
	busy: boolean
	workspace: string
	pan: GraphContext[`pan`]
	traced: Set<string>
	expanded: Set<string>
	traceStatus: string
	capturedAt: string
	empty: boolean
	emptyText: string
	liveKey?: string | undefined
	generation: number
	draftPinned: boolean
}
export function EcologyView(props: {
	tools: Tools
	context: GraphContext
}): SpaElement {
	const marker = `ecology-${useId()}`
	const presentation = usePresentation<EcologyPresentation>(props.tools.store, {
		selectionOutside: false,
		cardSlots: 0,
		edgeSlots: 0,
		visibleCards: 0,
		visibleEdges: 0,
		cards: [],
		edges: [],
		selected: undefined,
		liveKey: undefined,
		counts: ``,
		notice: ``,
		status: ``,
		truncated: false,
		hits: [],
		busy: false,
		workspace: `graph`,
		pan: props.context.pan,
		traced: new Set(),
		expanded: new Set(),
		traceStatus: `Not traced`,
		capturedAt: ``,
		empty: false,
		emptyText: ``,
		draftPinned: false,
		generation: 0,
	})
	let host: HTMLElement | null = null
	let controller: ReturnType<typeof createEcologyController> | undefined
	const state = presentation.read
	const publish = presentation.update
	onMount(() => {
		controller = createEcologyController(
			host!,
			props.tools.store,
			props.context,
			publish,
			marker,
		)
		onCleanup(controller.dispose)
	})
	onCommit(presentation.version, () => {
		controller?.committed()
	})
	const selected = () => state().selected
	const family = () => {
		const source = selected()?.source
		return source && `memberKeys` in source ? source : undefined
	}
	const node = () => {
		const source = selected()?.source
		return source && !(`memberKeys` in source) ? source : undefined
	}
	const liveToken = () => {
		const key = state().liveKey
		const store = props.tools.store
		const value = key
			? (store.atoms.get(key) ??
				store.readonlySelectors.get(key) ??
				store.writableSelectors.get(key))
			: undefined
		return value ? deposit(value) : undefined
	}
	const traced = (item: GraphModel[`items`][number]) =>
		`memberKeys` in item.source
			? item.source.memberKeys.some((key) => state().traced.has(key))
			: state().traced.has(item.key)
	const caption = (text: string) =>
		text.length > 23 ? `${text.slice(0, 22)}…` : text
	return (
		<ecology-view
			class={css.class}
			ref={(element) => {
				host = element
			}}
			data-testid="ecology-view"
			data-workspace={state().workspace}
		>
			<ecology-search>
				<form>
					<input
						type="search"
						aria-label="Search ecology"
						placeholder="Search keys, families, types"
					/>
					<button type="button" data-action="clear-query">
						Clear search
					</button>
					<button type="button" data-action="refresh">
						Refresh
					</button>
					<button type="button" data-action="clear">
						Clear selection
					</button>
					<button type="button" data-action="fit">
						Fit
					</button>
					<button type="button" data-action="reset">
						Reset view
					</button>
				</form>
				<p data-counts role="status">
					{state().counts}
				</p>
				<details data-capture>
					<summary>
						Capture details &amp; legend
						{state().truncated ? ` · truncated capture` : ``}
					</summary>
					<p data-notice>{state().notice}</p>
					<p data-legend>
						□ atom · ⬡ selector · dashed group: family · arrows: dependency →
						dependent · blue: traced path
					</p>
				</details>
				<p data-search-status role="status">
					{state().status}
				</p>
				<ol
					data-results
					aria-label="ecology search results"
					aria-busy={state().busy ? `true` : undefined}
				>
					{state().hits.map((hit) => (
						<li key={hit.document.id}>
							<button
								type="button"
								data-action="result"
								data-result-id={hit.document.id}
								aria-label={hit.document.key}
							>
								{
									<HighlightedText
										text={hit.document.label}
										ranges={hit.ranges}
									/>
								}
							</button>
							<small>
								{hit.document.detail}
								{hit.approximate ? ` · approximate match` : ``}
							</small>
						</li>
					))}
				</ol>
				<nav data-workspace aria-label="Ecology workspace">
					{[`graph`, `list`, `selection`].map((view, index) => (
						<button
							key={view}
							type="button"
							data-action={`view-${view}`}
							aria-pressed={state().workspace === view}
							aria-controls={
								view === `selection` ? `${marker}-selection` : `${marker}-map`
							}
						>
							{[`Graph`, `Node list`, `Selection`][index]}
						</button>
					))}
				</nav>
				<ecology-body>
					<ecology-map id={`${marker}-map`}>
						<nav aria-label="Graph navigation">
							{[
								[`left`, `Pan left`, `←`],
								[`right`, `Pan right`, `→`],
								[`up`, `Pan up`, `↑`],
								[`down`, `Pan down`, `↓`],
								[`in`, `Zoom in`, `+`],
								[`out`, `Zoom out`, `−`],
							].map(([action, label, text]) => (
								<button
									key={action}
									type="button"
									data-action={action}
									aria-label={label}
								>
									{text}
								</button>
							))}
						</nav>
						<p data-empty role="status" hidden={!state().empty}>
							{state().emptyText}
						</p>
						<svg role="group" aria-label="Observed dependency graph">
							<defs>
								<marker
									id={marker}
									markerWidth="8"
									markerHeight="8"
									refX="9"
									refY="4"
									markerUnits="userSpaceOnUse"
									orient="auto"
								>
									<path d="M0 0 L8 4 L0 8 Z" fill="currentColor" />
								</marker>
							</defs>
							<g
								data-world
								transform={`translate(${state().pan.x} ${state().pan.y}) scale(${state().pan.zoom})`}
							>
								<g data-edges>
									{Array.from({ length: state().edgeSlots }, (_, index) => {
										const edge = () => state().edges[index]
										return (
											<path
												key={`${state().generation}:${index}`}
												data-edge={
													index < state().visibleEdges ? true : undefined
												}
												display={
													index >= state().visibleEdges ? `none` : undefined
												}
												data-traced={
													index < state().visibleEdges &&
													state().traced.size > 0 &&
													edge().traced
												}
												marker-end={`url(#${marker})`}
												d={edge().path}
											/>
										)
									})}
								</g>
								<g data-cards>
									{Array.from({ length: state().cardSlots }, (_, index) => {
										const item = () => state().cards[index]
										return (
											<g
												key={`${state().generation}:${index}`}
												data-node
												display={
													index >= state().visibleCards ? `none` : undefined
												}
												data-kind={item().kind}
												data-traced={
													index < state().visibleCards && traced(item())
												}
												data-graph-id={
													index < state().visibleCards ? item().id : undefined
												}
												role="button"
												tabIndex={0}
												aria-label={`${item().label} · ${item().detail}`}
												aria-pressed={selected()?.id === item().id}
												transform={`translate(${item().x} ${item().y})`}
											>
												<path
													d={
														item().kind === `selector`
															? `M12 0 L164 0 L176 26 L164 52 L12 52 L0 26 Z`
															: item().kind === `family`
																? `M8 0 H168 Q176 0 176 8 V44 Q176 52 168 52 H8 Q0 52 0 44 V8 Q0 0 8 0 Z`
																: `M0 0 H176 V52 H0 Z`
													}
												/>
												<text x="10" y="20">
													{caption(item().label)}
												</text>
												<text x="10" y="39">
													{caption(item().detail)}
												</text>
											</g>
										)
									})}
								</g>
							</g>
						</svg>
						<details>
							<summary>Accessible node list</summary>
							<ul>
								{Array.from({ length: state().cardSlots }, (_, index) => {
									const item = () => state().cards[index]
									return (
										<li
											key={`${state().generation}:${index}`}
											hidden={index >= state().visibleCards}
										>
											<button
												type="button"
												data-action="select"
												data-graph-id={
													index < state().visibleCards ? item().id : undefined
												}
												aria-pressed={selected()?.id === item().id}
											>{`${item().kind === `selector` ? `◇` : item().kind === `family` ? `▸` : `□`} ${item().label} · ${item().detail}`}</button>
										</li>
									)
								})}
							</ul>
						</details>
					</ecology-map>
					<aside
						id={`${marker}-selection`}
						aria-label="Passive ecology inspector"
						tabIndex={-1}
					>
						{selected() ? (
							<>
								<h2 tabIndex={-1}>{selected()?.key}</h2>
								<p>{selected()?.detail}</p>
								{state().selectionOutside ? (
									<p data-selection-context>
										Retained selection · outside the current view.
									</p>
								) : null}
								{family() ? (
									<>
										<p>{`${family()?.memberCount}${family()?.countComplete ? `` : `+`} instantiated members`}</p>
										<button type="button" data-action="expand">
											{state().expanded.has(selected()!.key)
												? `Collapse family`
												: `Expand family`}
										</button>
									</>
								) : (
									<>
										<p>{`${node()?.type.startsWith(`readonly`) ? `Readonly` : `Writable`} ${node()?.kind}`}</p>
										<p>{`Dependencies: ${node()?.dependencies}${node()?.dependenciesTruncated ? ` (truncated)` : ``}`}</p>
										<button type="button" data-action="trace">
											Trace observed roots
										</button>
										<button type="button" data-action="live">
											Open live editor (may read/evaluate)
										</button>
									</>
								)}
								<p>{state().traceStatus}</p>
								<p>{`Observed snapshot ${state().capturedAt}. Retained edges can be stale or partial; other dependencies may be unknown.`}</p>
							</>
						) : (
							<p>
								{props.context.selected
									? `Selection outside this captured snapshot`
									: `Select a node to inspect metadata without reading its value.`}
							</p>
						)}
					</aside>
				</ecology-body>
			</ecology-search>
			<ecology-live-panel
				hidden={!state().liveKey}
				data-draft-pinned={String(state().draftPinned)}
			>
				<live-heading>
					<span>{`Editing ${state().liveKey} — kept visible during search`}</span>
					<button type="button" data-action="back">
						Back to passive inspector
					</button>
				</live-heading>
				<ecology-live>
					{liveToken() ? (
						<StateLeaf
							retained
							key={state().liveKey}
							tools={props.tools}
							token={liveToken()!}
						/>
					) : state().liveKey ? (
						<p>State was disposed. Refresh to update the snapshot.</p>
					) : null}
				</ecology-live>
			</ecology-live-panel>
		</ecology-view>
	)
}
