import "./globals.css"

import { Silo } from "atom.io"
import { StoreProvider } from "atom.io/react"
import { render } from "preact"
import { io } from "socket.io-client"

import { createVectorCollaborationClient } from "./collaboration-client.ts"
import { getBrowserSession } from "./session.ts"
import { VectorWorkspace } from "./VectorWorkspace.tsx"

const { identity, sessionId } = getBrowserSession()
const silo = new Silo({
	name: `vector-client:${sessionId}`,
	lifespan: `ephemeral`,
	isProduction: import.meta.env.PROD,
})
const socket = io(window.location.origin, {
	auth: { actor: identity.id, session: sessionId },
	reconnection: true,
	reconnectionDelayMax: 4_000,
})
const client = await createVectorCollaborationClient({
	identity,
	sessionId,
	silo,
	socket,
})

render(
	<StoreProvider store={silo.store}>
		<VectorWorkspace client={client} />
	</StoreProvider>,
	document.getElementById(`root`)!,
)
