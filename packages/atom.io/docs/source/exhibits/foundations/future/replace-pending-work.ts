import { Future } from "atom.io/foundations/future"

const slow = new Promise<string>((resolve) => {
	setTimeout(() => {
		resolve(`slow`)
	}, 1000)
})

const result = new Future(slow)

result.use(Promise.resolve(`fast`))

const text = await result
