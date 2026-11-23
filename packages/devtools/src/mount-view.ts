import { render, type SpaElement, type SpaRoot } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import type { RootStore } from "atom.io/internal"

export function mountView(
	host: Element,
	tag: string,
	store: RootStore,
	view: (container: HTMLElement) => SpaElement,
): { dispose(): void } {
	const container = host.ownerDocument.createElement(tag)
	host.append(container)
	let root: SpaRoot
	try {
		root = render(() => view(container), container, {
			store,
			capabilities: [motionCapability()],
		})
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
