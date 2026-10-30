import { hydrate, render } from "@atom.io/spa"
import { jsx } from "@atom.io/spa/jsx-runtime"
import { createResumption } from "resumability/client"

import Drafts from "./Drafts.spa.tsx"
import { createModel } from "./model.ts"

class ResumableDrafts extends HTMLElement {
	#dispose: (() => void) | undefined
	public connectedCallback(): void {
		// The sidecar is a following sibling of this host inside the wrapper.
		queueMicrotask(() => {
			if (!this.isConnected || this.#dispose) return
			const scope = createResumption(this.closest(`astro-resumption`)!)
			const model = createModel(scope)
			const host = this.querySelector<HTMLElement>(`[data-root]`)!
			const release = () => {
				try {
					model.dispose()
				} finally {
					scope.dispose()
				}
			}
			try {
				const root = (host.hasChildNodes() ? hydrate : render)(
					() => jsx(Drafts, { model }),
					host,
					{ store: model.silo.store, idPrefix: this.dataset.island! },
				)
				this.#dispose = () => {
					try {
						root.dispose()
					} finally {
						release()
					}
				}
				this.dataset.ready = `true`
			} catch (error) {
				release()
				throw error
			}
		})
	}
	public disconnectedCallback(): void {
		try {
			this.#dispose?.()
		} finally {
			this.#dispose = undefined
			delete this.dataset.ready
		}
	}
}

if (!customElements.get(`resumable-drafts`))
	customElements.define(`resumable-drafts`, ResumableDrafts)
