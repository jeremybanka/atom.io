/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onCommit, onMount, useId } from "@atom.io/spa"
import { deposit } from "atom.io/internal"

import { createEcologyController } from "./ecology-controller.ts"
import type { GraphContext, GraphModel } from "./ecology-graph.ts"
import type { EcologyLine } from "./ecology-lines.ts"
import { type CameraCommand, EcologyScene } from "./EcologyScene.tsx"
import css from "./EcologyView.module.css"
import { HighlightedText } from "./HighlightedText.tsx"
import type { SearchHit } from "./search.ts"
import { StateLeaf } from "./StateLeaf.tsx"
import { type Tools, usePresentation, useSlotPages } from "./store.ts"

export interface EcologyPresentation {
	cardSlots: number
	visibleCards: number
	cards: GraphModel[`items`]
	edges: EcologyLine[]
	selected?: GraphModel[`items`][number] | undefined
	selectionOutside: boolean
	counts: string
	notice: string
	status: string
	truncated: boolean
	hits: SearchHit[]
	busy: boolean
	workspace: string
	cameraCommand: CameraCommand
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
		visibleCards: 0,
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
		cameraCommand: { sequence: 0, action: `fit` },
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
	const cards = useSlotPages<EcologyPresentation[`cards`][number]>(
		props.tools.store,
		500,
	)
	const publish = (patch: Partial<EcologyPresentation>) => {
		if (patch.cards) cards.update(patch.cards, patch.visibleCards!)
		presentation.update(patch)
	}
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
						Atom / selector cards · dashed group: family · arrows: dependency →
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
						<EcologyScene
							tools={props.tools}
							context={props.context}
							slots={state().cardSlots}
							generation={state().generation}
							card={cards.value}
							visible={cards.visible}
							items={state().cards.slice(0, state().visibleCards)}
							edges={state().edges}
							selected={selected()?.id}
							traced={state().traced}
							workspace={state().workspace}
							command={state().cameraCommand}
						/>
						<details>
							<summary>Accessible node list</summary>
							<ul>
								{Array.from({ length: state().cardSlots }, (_, index) => {
									const item = () => cards.value(index)
									return (
										<li
											key={`${state().generation}:${index}`}
											hidden={!cards.visible(index)}
										>
											<button
												type="button"
												data-action="select"
												data-graph-id={
													cards.visible(index) ? item().id : undefined
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
