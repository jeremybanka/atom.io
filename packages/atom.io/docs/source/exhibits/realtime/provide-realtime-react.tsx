import { RealtimeProvider } from "atom.io/realtime-react"
import type { ReactElement, ReactNode } from "react"
import { io } from "socket.io-client"

const socket = io(globalThis.location?.origin ?? `http://localhost:3000`, {
	autoConnect: true,
})

export function CollaborationProvider({
	children,
}: {
	children: ReactNode
}): ReactElement {
	return <RealtimeProvider socket={socket}>{children}</RealtimeProvider>
}
