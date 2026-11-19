import { mountWorkerAtomIODevtools } from "@atom.io/spa-devtools"

const worker = new Worker(new URL(`./worker.js`, import.meta.url), {
	type: `module`,
})
const { port1, port2 } = new MessageChannel()
const panel = mountWorkerAtomIODevtools(
	document.querySelector(`#devtools`)!,
	port1,
)
worker.postMessage({ type: `connect`, port: port2 }, [port2])

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
window.addEventListener(
	`pagehide`,
	() => {
		panel.dispose()
		worker.terminate()
	},
	{ once: true },
)
