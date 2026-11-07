import { renderToString } from "@atom.io/spa/server"

import type { Props } from "../common.ts"
import { createApp } from "./app.tsx"

export function render(props: Props): string {
	const { store, App } = createApp(props)
	return renderToString(() => <App />, { store, idPrefix: `bench` })
}
