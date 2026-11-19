import { exposeDevtoolsStore } from "@atom.io/spa-devtools/worker"
import { Silo } from "atom.io"

const silo = new Silo({
	name: `Counter worker`,
	lifespan: `ephemeral`,
	isProduction: true,
})
const countAtom = silo.atom<number>({ key: `count`, default: 2 })
const doubledSelector = silo.selector<number>({
	key: `doubled`,
	get: ({ get }) => 2 * get(countAtom),
})
silo.timeline({ key: `count`, scope: [countAtom] })
const incrementTransaction = silo.transaction<() => void>({
	key: `increment`,
	do: ({ set }) => {
		set(countAtom, (value) => value + 1)
	},
})

type AppMessage = { type: `connect`; port: MessagePort } | { type: `increment` }
const worker = globalThis as unknown as Pick<
	Worker,
	`addEventListener` | `postMessage`
>
const report = () => {
	worker.postMessage({
		count: silo.getState(countAtom),
		doubled: silo.getState(doubledSelector),
	})
}
silo.subscribe(countAtom, () => {
	queueMicrotask(report)
})

worker.addEventListener(`message`, ({ data }: MessageEvent<AppMessage>) => {
	if (data.type === `connect`) {
		exposeDevtoolsStore(data.port, silo)
		report()
	} else {
		silo.runTransaction(incrementTransaction)()
	}
})
