import "./globals.css"

import { StoreProvider } from "@atom.io/solid"
import { render } from "@solidjs/web"

import { App } from "./App.tsx"

render(
	() => (
		<StoreProvider>
			<App />
		</StoreProvider>
	),
	document.getElementById(`app`)!,
)
