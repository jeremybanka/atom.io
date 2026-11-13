import "@atom.io/spa-devtools/css"

import { mountAtomIODevtools } from "@atom.io/spa-devtools"

export function attachDebugger(host: HTMLElement): () => void {
	const panel = mountAtomIODevtools(host, { hideByDefault: true })
	return panel.dispose
}
