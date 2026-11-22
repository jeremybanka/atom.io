import { jsx } from "@atom.io/spa/jsx-runtime"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"

import { DebuggerPanel } from "./DebuggerPanel.tsx"
import { mountView } from "./mount-view.ts"

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
	return mountView(host, `devtools`, store, () =>
		jsx(DebuggerPanel, { store, hideByDefault }),
	)
}
