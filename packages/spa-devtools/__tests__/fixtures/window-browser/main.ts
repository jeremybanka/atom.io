import { mountAtomIODevtools } from "@atom.io/spa-devtools"
import { Silo } from "atom.io"

import type { FrameSample } from "./timing.ts"
import { measureFrameSample } from "./timing.ts"

const app = new Silo({
	name: `window-browser`,
	lifespan: `ephemeral`,
	isProduction: true,
})
const countAtom = app.atom<number>({ key: `count`, default: 1 })
const host = document.createElement(`div`)
document.body.append(host)
let panel = mountAtomIODevtools(host, { store: app.store })
let resizeRevision = 0
window.addEventListener(`resize`, () => {
	resizeRevision++
})
declare global {
	interface Window {
		devtoolsWindowTest: {
			value(): number
			remount(): void
			dispose(): void
			resizeRevision(): number
			sample(reference: boolean, x: number, y: number): Promise<FrameSample>
		}
	}
}
window.devtoolsWindowTest = {
	value: () => app.getState(countAtom),
	resizeRevision: () => resizeRevision,
	sample(reference, x, y) {
		const element = host.querySelector<HTMLElement>(`main`)!
		const toolbar = element.querySelector<HTMLElement>(`.toolbar`)!
		return measureFrameSample({
			task(callback) {
				setTimeout(callback, 0)
			},
			frame(callback) {
				requestAnimationFrame(callback)
			},
			now: () => performance.now(),
			dispatch() {
				toolbar.dispatchEvent(
					reference
						? new Event(`devtools-frame-baseline`, { bubbles: true })
						: new PointerEvent(`pointermove`, {
								pointerId: 1,
								clientX: x,
								clientY: y,
								bubbles: true,
							}),
				)
			},
			read() {
				return {
					x: Number.parseFloat(element.style.left),
					y: Number.parseFloat(element.style.top),
					width: Number.parseFloat(element.style.width),
					height: Number.parseFloat(element.style.height),
				}
			},
		})
	},
	remount() {
		panel.dispose()
		panel = mountAtomIODevtools(host, { store: app.store })
	},
	dispose() {
		panel.dispose()
	},
}
