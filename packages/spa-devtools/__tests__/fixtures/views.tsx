/** @jsxImportSource @atom.io/spa */
import { onCleanup, onCommit, onMount, render } from "@atom.io/spa"
import type { RootStore } from "atom.io/internal"

import type { GraphContext } from "../../src/ecology-graph.ts"
import { EcologyView } from "../../src/EcologyView.tsx"
import type { SearchContext } from "../../src/search-controller.ts"
import { SearchView } from "../../src/SearchView.tsx"
import { useLocal, useTools } from "../../src/store.ts"
import {
	createWindowController,
	EDGE_LABELS,
} from "../../src/window-controller.ts"
import { rectStyle, RESIZE_EDGES } from "../../src/window-geometry.ts"
import {
	WindowOverlay,
	type WindowPresentation,
} from "../../src/WindowOverlay.tsx"

export function mountEcologyFixture(
	target: HTMLElement,
	store: RootStore,
	context: GraphContext,
): { dispose(): void; host: HTMLElement } {
	const root = render(
		() => <EcologyView tools={useTools(store)} context={context} />,
		target,
		{ store },
	)
	return {
		dispose: root.dispose,
		host: target.querySelector<HTMLElement>(`ecology-view`)!,
	}
}
export function mountSearchFixture(
	target: HTMLElement,
	store: RootStore,
	context: SearchContext,
): { dispose(): void; host: HTMLElement } {
	const root = render(
		() => (
			<SearchView tools={useTools(store)} type="atoms" context={context}>
				<article data-index />
			</SearchView>
		),
		target,
		{ store },
	)
	return {
		dispose: root.dispose,
		host: target.querySelector<HTMLElement>(`search-view`)!,
	}
}
export function mountWindowFixture(
	target: HTMLElement,
	store: RootStore,
	toggle: () => void,
): {
	flush(): void
	dispose(): void
	controller: ReturnType<typeof createWindowController>
	panel: HTMLElement
} {
	let controller: ReturnType<typeof createWindowController>
	const root = render(
		() => {
			const [state, setState] = useLocal<WindowPresentation>(store, {
				interaction: false,
				paletteHidden: true,
				menuOpen: false,
				selected: null,
			})
			let panel: HTMLElement | null = null
			onMount(() => {
				controller = createWindowController(panel!, toggle, (patch) => {
					setState((previous) => ({ ...previous, ...patch }))
				})
				onCleanup(controller.dispose)
			})
			onCommit(state, () => {
				controller?.committed()
			})
			return (
				<main
					ref={(element) => {
						panel = element
					}}
					style={rectStyle(state().rect)}
					data-window-interaction={String(state().interaction)}
				>
					<debugger-toolbar>
						<button data-drag-handle>Move</button>
						<nav>
							<button>Atoms</button>
						</nav>
						<button data-testid="open-close-devtools">Minimize</button>
						<button
							aria-label="Debugger layout"
							aria-expanded={state().menuOpen}
						>
							□
						</button>
					</debugger-toolbar>
					<input value="2." />
					<WindowOverlay state={state()} />
					{RESIZE_EDGES.map((edge) => (
						<button
							key={edge}
							data-resize={edge}
							aria-label={`Resize debugger ${EDGE_LABELS[edge]}`}
						/>
					))}
				</main>
			)
		},
		target,
		{ store },
	)
	return {
		flush: root.flush,
		dispose: root.dispose,
		controller: { ...controller!, dispose: root.dispose },
		panel: target.querySelector<HTMLElement>(`main`)!,
	}
}
