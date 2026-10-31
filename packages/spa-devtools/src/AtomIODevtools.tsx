import type { VNode } from "@atom.io/spa"
import { onCleanup, onMount, render, useValue } from "@atom.io/spa"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"

import { StateIndex, TimelineIndex, TransactionIndex } from "./Indexes.tsx"
import { useLocal, useSaved, useTools } from "./store.ts"

export interface AtomIODevtoolsProps {
	/** Inspected store. Fixed for this component instance; change its key to replace it. */
	store?: RootStore
	hideByDefault?: boolean
}
/** Owns a rendering root in the inspected store, independently of its parent island. */
export function AtomIODevtools(props: AtomIODevtoolsProps): VNode {
	let host: HTMLElement | null = null
	const attach = (element: HTMLElement | null) => {
		host = element
	}
	onMount(() => {
		const store = props.store ?? IMPLICIT.STORE
		const root = render(
			() => <Panel store={store} hideByDefault={props.hideByDefault ?? false} />,
			host!,
			{ store },
		)
		onCleanup(root.dispose)
	})
	return <spa-devtools ref={attach} />
}
const VIEWS = [`atoms`, `selectors`, `transactions`, `timelines`] as const
type View = (typeof VIEWS)[number]
function Panel(props: { store: RootStore; hideByDefault: boolean }): VNode {
	const tools = useTools(props.store)
	const [hidden, setHidden] = useSaved(
		props.store,
		`🔍 Devtools Are Hidden`,
		props.hideByDefault,
	)
	const [open, setOpen] = useSaved(props.store, `🔍 Devtools Are Open`, true)
	const [selection, setSelection] = useSaved<string>(
		props.store,
		`🔍 Devtools View`,
		`atoms`,
	)
	const view = () =>
		VIEWS.includes(selection() as View) ? (selection() as View) : `atoms`
	const [position, setPosition] = useLocal(props.store, { x: 0, y: 0 })
	const error = useValue(tools.error)
	let panel: HTMLElement | null = null
	const attach = (element: HTMLElement | null) => {
		panel = element
	}
	let drag:
		| { id: number; startX: number; startY: number; x: number; y: number }
		| undefined
	onMount(() => {
		const shortcut = (event: KeyboardEvent) => {
			if (event.ctrlKey && event.shiftKey && event.code === `KeyA`) {
				event.preventDefault()
				setHidden((value) => !value)
			}
		}
		const reset = () => {
			setPosition({ x: 0, y: 0 })
		}
		document.addEventListener(`keydown`, shortcut)
		window.addEventListener(`resize`, reset)
		onCleanup(() => {
			document.removeEventListener(`keydown`, shortcut)
			window.removeEventListener(`resize`, reset)
		})
	})
	return (
		<main
			ref={attach}
			data-css="spa-devtools"
			data-testid="atom-io-devtools"
			hidden={hidden()}
			data-open={open()}
			style={`transform:translate(${position().x}px,${position().y}px)`}
		>
			<header class="toolbar">
				<button
					type="button"
					class="drag-handle"
					aria-label="Move debugger"
					title="Drag to move; arrow keys to nudge"
					onPointerdown={(event) => {
						if (event.button !== 0) return
						drag = {
							id: event.pointerId,
							startX: event.clientX,
							startY: event.clientY,
							...position(),
						}
						;(event.currentTarget as HTMLElement).setPointerCapture(
							event.pointerId,
						)
					}}
					onPointermove={(event) => {
						if (!drag || drag.id !== event.pointerId || !panel) return
						const rect = panel.getBoundingClientRect()
						const next = {
							x: drag.x + event.clientX - drag.startX,
							y: drag.y + event.clientY - drag.startY,
						}
						next.x = Math.max(
							position().x - rect.left,
							Math.min(next.x, position().x + window.innerWidth - rect.right),
						)
						next.y = Math.max(
							position().y - rect.top,
							Math.min(next.y, position().y + window.innerHeight - rect.bottom),
						)
						setPosition(next)
					}}
					onPointerup={() => {
						drag = undefined
					}}
					onPointercancel={() => {
						drag = undefined
					}}
					onKeydown={(event) => {
						const step = {
							ArrowLeft: [-10, 0],
							ArrowRight: [10, 0],
							ArrowUp: [0, -10],
							ArrowDown: [0, 10],
						}[event.key]
						if (step) {
							event.preventDefault()
							setPosition(({ x, y }) => ({ x: x + step[0], y: y + step[1] }))
						}
					}}
				>
					⠿
				</button>
				<h1>atom.io</h1>
				{open() ? (
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
					aria-label={open() ? `Minimize debugger` : `Open debugger`}
					data-testid="open-close-devtools"
					onClick={() => {
						setOpen((value) => !value)
					}}
				>
					{open() ? `−` : `🔍`}
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
			{open() ? (
				<>
					{error() ? <p role="alert">{error()}</p> : null}
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
