/** @jsxImportSource @atom.io/spa */
import "./globals.css"

import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onCommit, onMount, useGetter } from "@atom.io/spa"
import { BrandMark } from "@atom.io/spa/brand"
import type { RootStore } from "atom.io/internal"

import css from "./DebuggerPanel.module.css"
import { createGraphContext } from "./ecology-graph.ts"
import { EcologyView } from "./EcologyView.tsx"
import type { StorePicker } from "./mount.ts"
import type { WorkerPanelConnection } from "./mount-worker.ts"
import { createSearchContext } from "./search-controller.ts"
import { SearchView } from "./SearchView.tsx"
import { StateIndex } from "./StateIndex.tsx"
import { useLocal, useSaved, useTools } from "./store.ts"
import { StorePickerControl } from "./StorePickerControl.tsx"
import { TimelineIndex } from "./TimelineIndex.tsx"
import { TransactionIndex } from "./TransactionIndex.tsx"
import { createWindowController, EDGE_LABELS } from "./window-controller.ts"
import { LAUNCHER_SIZE, rectStyle, RESIZE_EDGES } from "./window-geometry.ts"
import { WindowOverlay, type WindowPresentation } from "./WindowOverlay.tsx"

const VIEWS = [
	`atoms`,
	`selectors`,
	`transactions`,
	`timelines`,
	`ecology`,
] as const
type View = (typeof VIEWS)[number]
let nextPanelId = 0
export function DebuggerPanel(props: {
	store: RootStore
	hideByDefault: boolean
	worker?: WorkerPanelConnection | undefined
	picker?: StorePicker | undefined
}): SpaElement {
	const tools = useTools(props.store, props.worker)
	const views = VIEWS
	const picker = props.picker
	const [active, setActive] = useLocal(
		props.store,
		!picker || picker.selected() === picker.id,
	)
	const panelId = `spa-devtools-${nextPanelId++}`
	const [windowState, setWindowState] = useLocal<WindowPresentation>(
		props.store,
		{ interaction: false, paletteHidden: true, menuOpen: false, selected: null },
	)
	const graphContext = createGraphContext()
	const searchContexts = {
		atoms: createSearchContext(),
		selectors: createSearchContext(),
		transactions: createSearchContext(),
		timelines: createSearchContext(),
	}
	const [getHidden, setHidden] = useSaved(
		props.store,
		`🔍 Devtools Are Hidden`,
		props.hideByDefault,
	)
	const [getOpen, setOpen] = useSaved(props.store, `🔍 Devtools Are Open`, true)
	const [getSelection, setSelection] = useSaved<string>(
		props.store,
		picker
			? `🔍 Devtools View ` + picker.id
			: props.worker
				? `🔍 Worker Devtools View`
				: `🔍 Devtools View`,
		`atoms`,
	)
	const view = () =>
		views.includes(getSelection() as View) ? (getSelection() as View) : `atoms`
	const getError = useGetter(tools.error)
	let panel: HTMLElement | null = null
	const attach = (element: HTMLElement | null) => {
		panel = element
	}
	let controller: ReturnType<typeof createWindowController> | undefined
	const hidden = () => !active() || getHidden()
	onMount(() => {
		if (picker)
			onCleanup(
				picker.subscribe((id) => {
					setActive(id === picker.id)
					if (id === picker.id) {
						setHidden(false)
						setOpen(true)
						queueMicrotask(() => {
							panel
								?.querySelector<HTMLButtonElement>(`[data-store-trigger]`)
								?.focus()
						})
					}
				}),
			)
		controller = createWindowController(
			panel!,
			() => {
				setHidden((value) => !value)
			},
			(patch) => {
				setWindowState((previous) => ({ ...previous, ...patch }))
			},
			active,
		)
		controller.visibility(hidden(), getOpen())
		onCleanup(controller.dispose)
	})
	onCommit(windowState, () => {
		controller?.committed()
	})
	onCommit(
		() => `${hidden()}:${getOpen()}`,
		() => {
			controller?.visibility(hidden(), getOpen())
		},
	)
	return (
		<debugger-panel
			motion:layoutRoot
			class={css.class}
			role="main"
			ref={attach}
			data-css="spa-devtools"
			data-testid="atom-io-devtools"
			hidden={hidden()}
			data-open={getOpen()}
			data-window-interaction={String(windowState().interaction)}
			style={rectStyle(windowState().rect)}
		>
			<debugger-toolbar>
				<button
					type="button"
					data-drag-handle
					aria-label="Move debugger"
					title="Drag to move; arrow keys to nudge"
				>
					{getOpen() && !hidden() && <BrandMark size={32} />}
				</button>
				<h1>atom.io</h1>
				{getOpen() ? (
					<nav role="tablist" aria-label="Debugger views">
						{views.map((name) => (
							<span key={name} role="presentation">
								<button
									type="button"
									role="tab"
									aria-selected={view() === name}
									aria-controls={`${panelId}-content`}
									id={`${panelId}-${name}`}
									tabIndex={view() === name ? 0 : -1}
									onKeyDown={(event) => {
										const index = views.indexOf(name)
										let next: number
										if (event.key === `ArrowRight`)
											next = (index + 1) % views.length
										else if (event.key === `ArrowLeft`)
											next = (index + views.length - 1) % views.length
										else if (event.key === `Home`) next = 0
										else if (event.key === `End`) next = views.length - 1
										else return
										event.preventDefault()
										setSelection(views[next])
										event.currentTarget
											.closest(`nav`)!
											.querySelectorAll<HTMLButtonElement>(`[role="tab"]`)
											[next].focus()
									}}
									data-testid={`view-${name}`}
									onClick={() => {
										setSelection(name)
									}}
								>
									{name}
								</button>
							</span>
						))}
					</nav>
				) : null}
				{picker && getOpen() && !hidden() ? (
					<StorePickerControl
						picker={picker}
						store={props.store}
						menuId={panelId + `-stores`}
					/>
				) : null}
				<button
					type="button"
					aria-label={getOpen() ? `Minimize debugger` : `Open debugger`}
					data-testid="open-close-devtools"
					data-drag-handle={getOpen() ? undefined : true}
					title={
						getOpen()
							? undefined
							: `Drag to move; click to open; arrow keys to nudge`
					}
					onClick={() => {
						setOpen((value) => !value)
					}}
				>
					{getOpen() ? `−` : !hidden() && <BrandMark size={LAUNCHER_SIZE} />}
				</button>
				<button
					type="button"
					aria-label="Debugger layout"
					title="Debugger layout: halves, thirds, full viewport or restore"
					aria-expanded={windowState().menuOpen}
				>
					□
				</button>
				<button
					type="button"
					aria-label="Hide debugger (Ctrl+Shift+A)"
					onClick={() => {
						setHidden(true)
					}}
				>
					×
				</button>
			</debugger-toolbar>
			{getOpen() ? (
				<debugger-content
					role="tabpanel"
					id={`${panelId}-content`}
					aria-labelledby={`${panelId}-${view()}`}
					tabIndex={0}
				>
					{getError() ? <p role="alert">{getError()}</p> : null}
					{view() === `ecology` ? (
						hidden() ? null : (
							<EcologyView tools={tools} context={graphContext} />
						)
					) : (
						<SearchView
							key={view()}
							tools={tools}
							type={
								view() as `atoms` | `selectors` | `transactions` | `timelines`
							}
							context={searchContexts[view() as keyof typeof searchContexts]}
						>
							{view() === `atoms` || view() === `selectors` ? (
								<StateIndex
									tools={tools}
									type={view() as `atoms` | `selectors`}
								/>
							) : view() === `transactions` ? (
								<TransactionIndex tools={tools} />
							) : (
								<TimelineIndex tools={tools} />
							)}
						</SearchView>
					)}
				</debugger-content>
			) : null}
			<WindowOverlay state={windowState()} />
			{RESIZE_EDGES.map((edge) => (
				<button
					key={edge}
					type="button"
					data-resize={edge}
					aria-label={`Resize debugger ${EDGE_LABELS[edge]}`}
					title={`Resize ${EDGE_LABELS[edge]}; use arrow keys`}
				/>
			))}
		</debugger-panel>
	)
}
