import "@atom.io/devtools/css"

import { mountAtomIODevtools } from "@atom.io/devtools"

export function attachDebugger(host: HTMLElement): () => void {
	const panel = mountAtomIODevtools(host, { hideByDefault: true })
	return panel.dispose
}
