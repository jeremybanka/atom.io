import { render, type SpaRoot } from "@atom.io/spa"
import { jsx } from "@atom.io/spa/jsx-runtime"
import { motionCapability } from "@atom.io/spa/motion"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"

import { DebuggerPanel } from "./DebuggerPanel.tsx"

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
			() => jsx(DebuggerPanel, { store, hideByDefault }),
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
