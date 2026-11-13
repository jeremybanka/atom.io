import { mountAtomIODevtools } from "@atom.io/spa-devtools"
import { Silo } from "atom.io"

const app = new Silo({
	name: `window-browser`,
	lifespan: `ephemeral`,
	isProduction: true,
})
const countAtom = app.atom<number>({ key: `count`, default: 1 })
const host = document.createElement(`div`)
document.body.append(host)
let panel = mountAtomIODevtools(host, { store: app.store })
declare global {
	interface Window {
		devtoolsWindowTest: { value(): number; remount(): void; dispose(): void }
	}
}
window.devtoolsWindowTest = {
	value: () => app.getState(countAtom),
	remount() {
		panel.dispose()
		panel = mountAtomIODevtools(host, { store: app.store })
	},
	dispose() {
		panel.dispose()
	},
}
