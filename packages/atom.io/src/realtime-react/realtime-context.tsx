import { useI } from "atom.io/react"
import * as RTC from "atom.io/realtime-client"
import * as React from "react"
import type { Socket } from "socket.io-client"

export type RealtimeServiceCounter = {
	consumerCount: number
	dispose: () => void
}

export type RealtimeServiceKey = object | string

export type RealtimeReactStore = {
	socket: Socket | null
	services: Map<RealtimeServiceKey, RealtimeServiceCounter> | null
}

declare global {
	var ATOM_IO_REALTIME_REACT_CONTEXTS:
		| WeakMap<typeof React.createContext, React.Context<RealtimeReactStore>>
		| undefined
}

// Share with copies using this React instance, retaining separate renderer state.
const realtimeContexts = (globalThis.ATOM_IO_REALTIME_REACT_CONTEXTS ??=
	new WeakMap())
export const RealtimeContext: React.Context<RealtimeReactStore> =
	realtimeContexts.get(React.createContext) ??
	React.createContext<RealtimeReactStore>({
		socket: null,
		services: null,
	})
realtimeContexts.set(React.createContext, RealtimeContext)

export const RealtimeProvider: React.FC<{
	children: React.ReactNode
	socket: Socket | null
}> = ({ children, socket }) => {
	const services = React.useRef(
		new Map<RealtimeServiceKey, RealtimeServiceCounter>(),
	).current
	const setMySocketKey = useI(RTC.mySocketKeyAtom)
	React.useEffect(() => {
		const handleConnect = () => {
			setMySocketKey(socket?.id ? `socket::${socket.id}` : undefined)
		}
		const handleDisconnect = () => {
			setMySocketKey(undefined)
		}

		handleConnect()
		socket?.on(`connect`, handleConnect)
		socket?.on(`disconnect`, handleDisconnect)

		return () => {
			socket?.off(`connect`, handleConnect)
			socket?.off(`disconnect`, handleDisconnect)
			setMySocketKey(undefined)
		}
	}, [socket, setMySocketKey])
	return (
		<RealtimeContext.Provider value={{ socket, services }}>
			{children}
		</RealtimeContext.Provider>
	)
}
