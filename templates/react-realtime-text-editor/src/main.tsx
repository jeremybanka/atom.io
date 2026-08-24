import "./globals.css"

import { Silo } from "atom.io"
import { StoreProvider } from "atom.io/react"
import { createRoot } from "react-dom/client"
import { io } from "socket.io-client"

import { createMarkdownCollaborationClient } from "./collaboration-client.ts"
import { MarkdownWorkspace } from "./MarkdownWorkspace.tsx"
import { getBrowserSession } from "./session.ts"
import { createMarkdownWorkspaceState } from "./workspace-state.ts"

const session = getBrowserSession()
const silo = new Silo({
	isProduction: import.meta.env.PROD,
	lifespan: `ephemeral`,
	name: `markdown-client:${session.clientId}`,
})
const socket = io(window.location.origin, {
	auth: { actor: session.identity.id, session: session.clientId },
	reconnection: true,
	reconnectionDelayMax: 4_000,
})
const client = await createMarkdownCollaborationClient({
	identity: session.identity,
	sessionId: session.clientId,
	silo,
	socket,
})
const workspace = createMarkdownWorkspaceState({ client, silo })
window.addEventListener(
	`pagehide`,
	() => {
		workspace[Symbol.dispose]()
		client[Symbol.dispose]()
		socket.close()
	},
	{ once: true },
)

createRoot(document.getElementById(`root`)!).render(
	<StoreProvider store={silo.store}>
		<MarkdownWorkspace client={client} state={workspace} />
	</StoreProvider>,
)
