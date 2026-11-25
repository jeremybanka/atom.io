import { mountAtomIODevtools } from "@atom.io/devtools"
import { Silo } from "atom.io"

const worker = new Worker(new URL(`./worker.js`, import.meta.url), {
	type: `module`,
})
const local = new Silo({
	name: `Page`,
	lifespan: `ephemeral`,
	isProduction: true,
})
local.atom<string>({ key: `location`, default: `Main thread` })
const panel = mountAtomIODevtools(document.querySelector(`#devtools`)!, {
	stores: [
		{
			id: `worker`,
			label: `Counter worker`,
			kind: `remote`,
			connect() {
				const { port1, port2 } = new MessageChannel()
				worker.postMessage({ type: `connect`, port: port2 }, [port2])
				return port1
			},
		},
		{ id: `page`, label: `Page store`, kind: `local`, store: local.store },
	],
})

const output = document.querySelector<HTMLOutputElement>(`#worker-values`)!
worker.addEventListener(
	`message`,
	({ data }: MessageEvent<{ count: number; doubled: number }>) => {
		output.value = `Count: ` + data.count + ` · Doubled: ` + data.doubled
	},
)
document.querySelector(`#increment`)!.addEventListener(`click`, () => {
	worker.postMessage({ type: `increment` })
})
worker.addEventListener(`error`, panel.dispose, { once: true })
window.addEventListener(
	`pagehide`,
	() => {
		panel.dispose()
		worker.terminate()
	},
	{ once: true },
)
