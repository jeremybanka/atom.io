import type { SpaElement, SpaRoot } from "@atom.io/spa"
import { onCleanup, onCommit, onMount, render, useGetter } from "@atom.io/spa"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"

import { StateIndex, TimelineIndex, TransactionIndex } from "./Indexes.tsx"
import { useSaved, useTools } from "./store.ts"
import { createWindowController } from "./window-controller.ts"

export interface AtomIODevtoolsProps {
	/** Inspected store. Fixed for this component instance; change its key to replace it. */
	store?: RootStore
	hideByDefault?: boolean
}
export interface AtomIODevtoolsHandle {
	/** Dispose this panel's root, listeners and UI state. Safe to call repeatedly. */
	dispose(): void
}
/** Mount a panel in an owned child, preserving the host's other children. Options are fixed at mount. */
export function mountAtomIODevtools(
	host: Element,
	options: AtomIODevtoolsProps = {},
): AtomIODevtoolsHandle {
	const store = options.store ?? IMPLICIT.STORE
	const hideByDefault = options.hideByDefault ?? false
	const container = host.ownerDocument.createElement(`spa-devtools`)
	host.append(container)
	let root: SpaRoot
	try {
		root = render(
			() => <Panel store={store} hideByDefault={hideByDefault} />,
			container,
			{ store },
		)
	} catch (error) {
		container.remove()
		throw error
	}
	let disposed = false
	return {
		dispose() {
			if (disposed) return
			disposed = true
			try {
				root.dispose()
			} finally {
				container.remove()
			}
		},
	}
}
/** Owns a rendering root in the inspected store, independently of its parent island. */
export function AtomIODevtools(props: AtomIODevtoolsProps): SpaElement {
	let host: HTMLElement | null = null
	const attach = (element: HTMLElement | null) => {
		host = element
	}
	onMount(() => {
		onCleanup(mountAtomIODevtools(host!, props).dispose)
	})
	return <spa-devtools ref={attach} />
}
const VIEWS = [`atoms`, `selectors`, `transactions`, `timelines`] as const
type View = (typeof VIEWS)[number]
function Panel(props: { store: RootStore; hideByDefault: boolean }): SpaElement {
	const tools = useTools(props.store)
	const [getHidden, setHidden] = useSaved(
		props.store,
		`🔍 Devtools Are Hidden`,
		props.hideByDefault,
	)
	const [getOpen, setOpen] = useSaved(props.store, `🔍 Devtools Are Open`, true)
	const [getSelection, setSelection] = useSaved<string>(
		props.store,
		`🔍 Devtools View`,
		`atoms`,
	)
	const view = () =>
		VIEWS.includes(getSelection() as View) ? (getSelection() as View) : `atoms`
	const getError = useGetter(tools.error)
	let panel: HTMLElement | null = null
	const attach = (element: HTMLElement | null) => {
		panel = element
	}
	let controller: ReturnType<typeof createWindowController> | undefined
	onMount(() => {
		controller = createWindowController(panel!, () => {
			setHidden((value) => !value)
		})
		controller.visibility(getHidden(), getOpen())
		onCleanup(controller.dispose)
	})
	onCommit(
		() => `${getHidden()}:${getOpen()}`,
		() => {
			controller?.visibility(getHidden(), getOpen())
		},
	)
	return (
		<main
			ref={attach}
			data-css="spa-devtools"
			data-testid="atom-io-devtools"
			hidden={getHidden()}
			data-open={getOpen()}
		>
			<header class="toolbar">
				<button
					type="button"
					class="drag-handle"
					aria-label="Move debugger"
					title="Drag to move; arrow keys to nudge"
				>
					⠿
				</button>
				<h1>atom.io</h1>
				{getOpen() ? (
					<nav aria-label="Debugger views">
						{VIEWS.map((name) => (
							<button
								type="button"
								aria-pressed={view() === name}
								data-testid={`view-${name}`}
								onClick={() => {
									setSelection(name)
								}}
							>
								{name}
							</button>
						))}
					</nav>
				) : null}
				<button
					type="button"
					aria-label={getOpen() ? `Minimize debugger` : `Open debugger`}
					data-testid="open-close-devtools"
					onClick={() => {
						setOpen((value) => !value)
					}}
				>
					{getOpen() ? `−` : `🔍`}
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
			</header>
			{getOpen() ? (
				<>
					{getError() ? <p role="alert">{getError()}</p> : null}
					{view() === `atoms` || view() === `selectors` ? (
						<StateIndex
							key={view()}
							tools={tools}
							type={view() as `atoms` | `selectors`}
						/>
					) : view() === `transactions` ? (
						<TransactionIndex tools={tools} />
					) : (
						<TimelineIndex tools={tools} />
					)}
				</>
			) : null}
		</main>
	)
}
