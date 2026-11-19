import { render, type SpaRoot } from "@atom.io/spa"
import { jsx } from "@atom.io/spa/jsx-runtime"
import { motionCapability } from "@atom.io/spa/motion"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"

import { DebuggerPanel } from "./DebuggerPanel.tsx"
import { connectWorker, type WorkerPanelConnection } from "./mount-worker.ts"

export type AtomIODevtoolsTarget = {
	readonly id: string
	readonly label: string
} & (
	| { readonly kind: `local`; readonly store: RootStore }
	| { readonly kind: `remote`; readonly connect: () => MessagePort }
)

export interface StorePicker {
	id: string
	targets: readonly Pick<AtomIODevtoolsTarget, `id` | `label` | `kind`>[]
	selected(): string
	subscribe(listener: (id: string) => void): () => void
	select(id: string): void
}

export interface AtomIODevtoolsProps {
	/** Inspected store. Fixed for this component instance; change its key to replace it. */
	store?: RootStore
	/** Targets stay mounted until disposal. The first supplied target is initially visible. */
	stores?: readonly AtomIODevtoolsTarget[]
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
	const hide = options.hideByDefault ?? false
	const targets = options.stores
	if (!targets?.length)
		return mountPanel(host, options.store ?? IMPLICIT.STORE, hide)
	const ids = new Set(targets.map(({ id }) => id))
	if (ids.size !== targets.length)
		throw new Error(`Devtools target IDs must be unique`)
	let selected = targets[0].id
	const listeners = new Set<(id: string) => void>()
	const panels: AtomIODevtoolsHandle[] = []
	const dispose = () => {
		for (const panel of panels.splice(0).reverse()) panel.dispose()
	}
	try {
		for (const target of targets) {
			const picker: StorePicker = {
				id: target.id,
				targets,
				selected: () => selected,
				subscribe(listener) {
					listeners.add(listener)
					return () => {
						listeners.delete(listener)
					}
				},
				select(id) {
					if (id === selected || !ids.has(id)) return
					selected = id
					for (const listener of listeners) listener(id)
				},
			}
			panels.push(
				target.kind === `local`
					? mountPanel(host, target.store, hide, undefined, picker)
					: mountRemotePanel(host, target.connect(), hide, picker),
			)
		}
	} catch (error) {
		dispose()
		throw error
	}
	return { dispose }
}

/** Mount a panel for a single remote store, owning the supplied port. */
export function mountWorkerAtomIODevtools(
	host: Element,
	port: MessagePort,
	options: { hideByDefault?: boolean } = {},
): AtomIODevtoolsHandle {
	return mountRemotePanel(host, port, options.hideByDefault ?? false)
}

function mountRemotePanel(
	host: Element,
	port: MessagePort,
	hide: boolean,
	picker?: StorePicker,
): AtomIODevtoolsHandle {
	const connection = connectWorker(port)
	try {
		const panel = mountPanel(
			host,
			connection.store,
			hide,
			connection.worker,
			picker,
		)
		return {
			dispose() {
				try {
					panel.dispose()
				} finally {
					connection.close()
				}
			},
		}
	} catch (error) {
		connection.close()
		throw error
	}
}

function mountPanel(
	host: Element,
	store: RootStore,
	hideByDefault: boolean,
	worker?: WorkerPanelConnection,
	picker?: StorePicker,
): AtomIODevtoolsHandle {
	const container = host.ownerDocument.createElement(`spa-devtools`)
	host.append(container)
	let root: SpaRoot
	try {
		root = render(
			() => jsx(DebuggerPanel, { store, hideByDefault, worker, picker }),
			container,
			{ store, capabilities: [motionCapability()] },
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
