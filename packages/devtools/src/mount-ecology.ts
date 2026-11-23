import { jsx } from "@atom.io/spa/jsx-runtime"
import type { RootStore } from "atom.io/internal"

import { EcologyPanel } from "./EcologyPanel.tsx"
import { mountView } from "./mount-view.ts"

export interface EcologyProps {
	/** Inspected store. Fixed for this component instance; change its key to replace it. */
	store: RootStore
}

export interface EcologyHandle {
	/** Dispose the explorer and remove its child from the host. Safe to call repeatedly. */
	dispose(): void
}

/** Mount an inline explorer in an owned child, preserving the host's other children. */
export function mountEcology(
	host: Element,
	{ store }: EcologyProps,
): EcologyHandle {
	return mountView(host, `atom-io-ecology`, store, () =>
		jsx(EcologyPanel, { store }),
	)
}
