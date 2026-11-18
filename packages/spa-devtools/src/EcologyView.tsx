/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onCommit, onMount, useId } from "@atom.io/spa"

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
import { type Tools, usePresentation, useSlotPages } from "./store.ts"

export interface EcologyPresentation {
	cylinderHeight: number
	cardSlots: number
	visibleCards: number
	cards: GraphModel[`items`]
	rows: GraphModel[`rows`]
	rowCount: number
	rowIds: ReadonlySet<string>
	matches: ReadonlySet<string> | undefined
	edges: EcologyLine[]
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
	traceStatus: string
	capturedAt: string
	empty: boolean
	emptyText: string
	generation: number
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
		cardSlots: 0,
		visibleCards: 0,
		cards: [],
		rows: [],
		rowCount: 0,
		rowIds: new Set(),
		matches: undefined,
		edges: [],
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
		traceStatus: `Not traced`,
		capturedAt: ``,
		empty: false,
		emptyText: ``,
		pinnedKey: undefined,
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
	return (
		<ecology-view
			class={css.class}
			ref={(element) => {
				host = element
			}}
			data-testid="ecology-view"
		>
			<EcologyToolbar marker={marker} state={state()} />
			<ecology-body>
				<ecology-map>
					<EcologyViewport
						tools={props.tools}
						context={props.context}
						cylinderHeight={state().cylinderHeight}
						slots={state().cardSlots}
						generation={state().generation}
						card={cards.value}
						visible={cards.visible}
						items={state().cards.slice(0, state().visibleCards)}
						edges={state().edges}
						selected={state().selectedCard}
						selectedIds={state().selectedIds}
						traced={state().traced}
						focused={state().focused}
						matches={state().matches}
						command={state().cameraCommand}
					/>
				</ecology-map>
				<EcologyEditor
					tools={props.tools}
					state={state()}
					onGenerate={(key) => {
						controller?.refresh(key)
					}}
				/>
			</ecology-body>
			<EcologyGuide marker={marker} notice={state().notice} />
		</ecology-view>
	)
}
