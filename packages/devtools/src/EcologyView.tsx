/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onCommit, onMount, useId } from "@atom.io/spa"
import type { FutureActivity } from "atom.io/introspection"
import { animate } from "motion"

import { createEcologyController } from "./ecology-controller.ts"
import type { GraphContext, GraphModel } from "./ecology-graph.ts"
import type { EcologyLine } from "./ecology-lines.ts"
import { EcologyEditor } from "./EcologyEditor.tsx"
import { EcologyGuide } from "./EcologyGuide.tsx"
import type { CameraCommand } from "./EcologyScene.tsx"
import { EcologyToolbar } from "./EcologyToolbar.tsx"
import css from "./EcologyView.module.css"
import { EcologyViewport } from "./EcologyViewport.tsx"
import { EditorIcon, type EditorIconName } from "./EditorIcon.tsx"
import type { SearchHit } from "./search.ts"
import { type EditorTools, useLocal, usePresentation } from "./store.ts"

export interface EcologyActivity {
	revision: number
	at: number
	future?: ReadonlySet<FutureActivity>
}

export interface EcologyPresentation {
	cylinderHeight: number
	cards: GraphModel[`items`]
	rows: GraphModel[`rows`]
	rowCount: number
	rowIds: ReadonlySet<string>
	matches: ReadonlySet<string> | undefined
	edges: EcologyLine[]
	familyConnections: GraphModel[`familyConnections`]
	selected?: GraphModel[`items`][number] | undefined
	selectedCard?: string | undefined
	familyExpanded: boolean
	hasSelectedFamily: boolean
	hasSelection: boolean
	selectedIds: ReadonlySet<string>
	selectionOutside: boolean
	query: string
	filtered: boolean
	dialog: `search` | `guide` | null
	notice: string
	status: string
	hits: SearchHit[]
	busy: boolean
	cameraCommand: CameraCommand | undefined
	traced: Set<string>
	focused: ReadonlySet<string> | undefined
	expanded: Set<string>
	empty: boolean
	emptyText: string
	generation: number
	activity: ReadonlyMap<string, EcologyActivity>
	pinnedKey: string | undefined
}

function ViewportAction(props: {
	action: `expand` | `clear`
	available: boolean
	precedingAvailable?: boolean
	label: string
	icon: EditorIconName
	expanded?: boolean | undefined
}): SpaElement {
	let button: HTMLButtonElement | null = null
	let stop: (() => void) | undefined
	// Scope the exit to this button so minimizing the debugger can unmount the view immediately.
	onCleanup(() => {
		stop?.()
	})
	onCommit<readonly [boolean, boolean]>(
		() => [props.available, props.precedingAvailable ?? false],
		([available, preceding], [wasAvailable, wasPreceding] = [false, false]) => {
			if (available === wasAvailable) return
			stop?.()
			stop = undefined
			const node = button!
			const entering = node.hidden
			if (
				node.ownerDocument.defaultView!.matchMedia(
					`(prefers-reduced-motion: reduce)`,
				).matches
			) {
				node.hidden = !available
				node.style.removeProperty(`transform`)
				node.style.removeProperty(`opacity`)
				return
			}
			node.hidden = false
			const body = node.closest(`ecology-body`)!
			const narrow =
				node.ownerDocument.defaultView!.getComputedStyle(body).display === `flex`
			// In the stacked layout, pitch opens the turnstile from the map's bottom edge.
			const turn = (from: number, to: number) =>
				entering ? [from, 0] : available ? 0 : to
			const animation = animate(
				node,
				{
					z: turn(-52, 70),
					rotateX: turn(narrow ? 62 : 16, narrow ? -52 : -18),
					rotateY: turn(narrow ? 12 : 58, narrow ? -10 : -52),
					opacity: entering ? [0, 1] : Number(available),
				},
				{
					delay: preceding === wasPreceding ? 0 : 0.02,
					type: `tween`,
					duration: 0.24,
					ease: available ? [0.1, 0.9, 0.2, 1] : [0.7, 0, 1, 0.5],
				},
			)
			let active = true
			if (!available)
				void animation.then(() => {
					if (active) node.hidden = true
				})
			stop = () => {
				active = false
				animation.stop()
			}
		},
	)
	return (
		<button
			ref={(node) => {
				button = node
			}}
			type="button"
			hidden
			inert={!props.available}
			data-action={props.action}
			aria-hidden={props.available ? undefined : `true`}
			aria-label={props.label}
			aria-expanded={props.expanded}
			title={props.label}
		>
			<EditorIcon name={props.icon} />
		</button>
	)
}

export function EcologyView(props: {
	tools: EditorTools
	context: GraphContext
	scope(): HTMLElement
}): SpaElement {
	const marker = `ecology-${useId()}`
	const presentation = usePresentation<EcologyPresentation>(props.tools.store, {
		cylinderHeight: 8,
		selectionOutside: false,
		cards: [],
		rows: [],
		rowCount: 0,
		rowIds: new Set(),
		matches: undefined,
		edges: [],
		familyConnections: [],
		selected: undefined,
		selectedCard: undefined,
		familyExpanded: false,
		hasSelectedFamily: false,
		hasSelection: false,
		selectedIds: new Set(),
		query: props.context.query,
		filtered: false,
		dialog: null,
		notice: ``,
		status: ``,
		hits: [],
		busy: false,
		cameraCommand: undefined,
		traced: new Set(),
		focused: undefined,
		expanded: new Set(),
		empty: false,
		emptyText: ``,
		pinnedKey: undefined,
		generation: 0,
		activity: new Map(),
	})
	const [hovered, setHovered] = useLocal<string | undefined>(
		props.tools.store,
		undefined,
	)
	let host: HTMLElement | null = null
	let controller: ReturnType<typeof createEcologyController> | undefined
	const state = presentation.read
	const selectedFamily = () => {
		const selected = state().selected
		return selected?.kind === `family` ? selected.key : selected?.familyLabel
	}
	const hover = (event: PointerEvent) => {
		const target =
			event.type === `pointerout` ? event.relatedTarget : event.target
		const item =
			event.pointerType !== `touch` &&
			target instanceof Element &&
			host!.contains(target)
				? target.closest<HTMLElement>(`[data-graph-id], ecology-editor-row`)
				: undefined
		setHovered(item?.dataset[`graphId`] ?? item?.dataset[`rowId`])
	}
	onMount(() => {
		controller = createEcologyController(
			host!,
			props.scope(),
			props.tools.store,
			props.context,
			presentation.update,
			marker,
			props.tools.worker,
		)
		onCleanup(controller.dispose)
	})
	onCommit(presentation.version, () => {
		controller?.committed()
	})
	return (
		<ecology-view
			class={css.class}
			ref={(element) => {
				host = element
			}}
			data-testid="ecology-view"
			onPointerOver={hover}
			onPointerOut={hover}
			onPointerCancel={() => {
				setHovered(undefined)
			}}
		>
			<EcologyToolbar marker={marker} state={state()} />
			<ecology-body>
				<ecology-map>
					<EcologyViewport
						tools={props.tools}
						context={props.context}
						cylinderHeight={state().cylinderHeight}
						generation={state().generation}
						items={state().cards}
						activity={state().activity}
						edges={state().edges}
						familyConnections={state().familyConnections}
						selected={state().selectedCard}
						selectedFamily={selectedFamily()}
						selectedIds={state().selectedIds}
						traced={state().traced}
						focused={state().focused}
						matches={state().matches}
						command={state().cameraCommand}
						hovered={hovered()}
					/>
					<ecology-map-actions>
						<ViewportAction
							action="expand"
							available={state().hasSelectedFamily}
							label={
								state().familyExpanded ? `Collapse family` : `Expand family`
							}
							icon={state().familyExpanded ? `collapseFamily` : `expandFamily`}
							expanded={state().familyExpanded}
						/>
						<ViewportAction
							action="clear"
							available={state().hasSelection}
							precedingAvailable={state().hasSelectedFamily}
							label="Clear selection"
							icon="clearSelection"
						/>
					</ecology-map-actions>
				</ecology-map>
				<EcologyEditor
					tools={props.tools}
					state={state()}
					hovered={hovered()}
					onGenerate={(key) => {
						controller?.refresh(key)
					}}
				/>
			</ecology-body>
			<EcologyGuide marker={marker} notice={state().notice} />
		</ecology-view>
	)
}
