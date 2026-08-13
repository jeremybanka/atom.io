import "./globals.css"

import { RealtimeProvider } from "atom.io/realtime-react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { io } from "socket.io-client"

import { MarkdownWorkspace } from "./MarkdownWorkspace.tsx"
import { getBrowserSession, realtimeAuth } from "./session.ts"

const session = getBrowserSession()
const socket = io(window.location.origin, {
	auth: realtimeAuth(session.identity, session.clientId),
	reconnection: true,
	reconnectionDelayMax: 4_000,
})

createRoot(document.getElementById(`root`)!).render(
	<StrictMode>
		<RealtimeProvider socket={socket}>
			<MarkdownWorkspace {...session} />
		</RealtimeProvider>
	</StrictMode>,
)
