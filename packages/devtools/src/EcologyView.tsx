/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onCommit, onMount, useId } from "@atom.io/spa"
import type { FutureActivity } from "atom.io/introspection"

import { createEcologyController } from "./ecology-controller.ts"
import type { GraphContext, GraphModel } from "./ecology-graph.ts"
import type { EcologyLine } from "./ecology-lines.ts"
import { EcologyEditor } from "./EcologyEditor.tsx"
import { EcologyGuide } from "./EcologyGuide.tsx"
import type { CameraCommand } from "./EcologyScene.tsx"
import { EcologyToolbar } from "./EcologyToolbar.tsx"
import css from "./EcologyView.module.css"
import { EcologyViewport } from "./EcologyViewport.tsx"
import type { SearchHit } from "./search.ts"
import { type Tools, useLocal, usePresentation } from "./store.ts"

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
	selectedIds: ReadonlySet<string>
	selectionOutside: boolean
	query: string
	filtered: boolean
	dialog: `search` | `guide` | null
	notice: string
	status: string
	hits: SearchHit[]
	busy: boolean
	cameraCommand: CameraCommand
	traced: Set<string>
	focused: ReadonlySet<string> | undefined
	expanded: Set<string>
	empty: boolean
	emptyText: string
	generation: number
	activity: ReadonlyMap<string, EcologyActivity>
	pinnedKey: string | undefined
}
export function EcologyView(props: {
	tools: Tools
	context: GraphContext
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
		selectedIds: new Set(),
		query: props.context.query,
		filtered: false,
		dialog: null,
		notice: ``,
		status: ``,
		hits: [],
		busy: false,
		cameraCommand: { sequence: 0, action: `fit` },
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
			props.tools.store,
			props.context,
			presentation.update,
			marker,
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
						selectedIds={state().selectedIds}
						traced={state().traced}
						focused={state().focused}
						matches={state().matches}
						command={state().cameraCommand}
						hovered={hovered()}
					/>
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
