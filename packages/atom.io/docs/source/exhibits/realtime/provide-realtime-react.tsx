import { RealtimeProvider } from "atom.io/realtime-react"
import type { ReactElement, ReactNode } from "react"
import { useEffect, useState } from "react"
import { io, type Socket } from "socket.io-client"

export function CollaborationProvider({
	children,
}: {
	children: ReactNode
}): ReactElement {
	const [socket, setSocket] = useState<Socket | null>(null)

	useEffect(() => {
		const connection = io(location.origin)
		setSocket(connection)
		return () => {
			setSocket(null)
			connection.disconnect()
		}
	}, [])

	return <RealtimeProvider socket={socket}>{children}</RealtimeProvider>
}
