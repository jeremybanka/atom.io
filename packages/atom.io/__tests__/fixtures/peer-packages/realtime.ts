import { RealtimeContext, type RealtimeReactStore } from "atom.io/realtime-react"
import { useContext } from "react"

function useRealtimeSocket() {
	const context = useContext(RealtimeContext)
	const { socket } = context
	// Also reject a context that silently degrades to any.
	// @ts-expect-error The published context has no such property.
	context.nonexistent
	return socket
}

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false
type Expect<T extends true> = T
type SocketType = Expect<
	Equal<ReturnType<typeof useRealtimeSocket>, RealtimeReactStore[`socket`]>
>
