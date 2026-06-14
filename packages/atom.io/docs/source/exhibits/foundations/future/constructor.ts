import { Future } from "atom.io/foundations/future"

const fromPromise = new Future(Promise.resolve(1))

const fromExecutor = new Future<number>((resolve) => {
	resolve(1)
})
