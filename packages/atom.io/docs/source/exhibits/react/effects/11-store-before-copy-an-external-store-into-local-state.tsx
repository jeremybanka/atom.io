import { useEffect, useState } from "react"

export type CounterStore = {
	getSnapshot: () => number
	subscribe: (listener: () => void) => () => void
}
export function Counter({ store }: { store: CounterStore }) {
	const [count, setCount] = useState(store.getSnapshot)
	useEffect(() => store.subscribe(() => setCount(store.getSnapshot())), [store])
	return <output>{count}</output>
}
