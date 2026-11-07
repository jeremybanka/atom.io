import { hydrate } from "@atom.io/spa"

import { createApp } from "./app.tsx"

export function activate(): void {
	performance.mark(`hydrate-start`)
	const props = JSON.parse(document.querySelector(`#props`)!.textContent)
	const { store, App } = createApp(props)
	hydrate(() => <App />, document.querySelector(`#app`)!, { store })
	performance.mark(`hydrate-end`)
	;(window as any).__ready = performance.now()
}
