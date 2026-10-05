import { createServer } from "node:http"

import { Server } from "socket.io"

import { identityById } from "../src/identities.ts"
import { createVectorCollaborationService } from "./service.ts"

const PORT = 3000
const collaboration = await createVectorCollaborationService()
const httpServer = createServer((request, response) => {
	if (request.url === `/health`) {
		response.writeHead(200, { "content-type": `application/json` })
		response.end(JSON.stringify({ ok: true, revision: collaboration.revision }))
		return
	}
	response.writeHead(404)
	response.end()
})
const socketServer = new Server(httpServer)

socketServer.on(`connection`, (socket) => {
	const requestedActor =
		typeof socket.handshake.auth.actor === `string`
			? socket.handshake.auth.actor
			: undefined
	const session =
		typeof socket.handshake.auth.session === `string`
			? socket.handshake.auth.session
			: ``
	const identity = identityById(requestedActor)
	if (
		identity.id !== requestedActor ||
		session.length === 0 ||
		session.includes(`::`)
	) {
		socket.disconnect(true)
		return
	}
	void collaboration.bindSocket({ actor: identity.id, session, socket })
})

httpServer.listen(PORT, () => {
	console.log(
		`Vector collaboration server listening on http://localhost:${PORT}`,
	)
})

const shutdown = (): void => {
	collaboration[Symbol.dispose]()
	void socketServer.close()
	httpServer.close()
}
process.once(`SIGINT`, shutdown)
process.once(`SIGTERM`, shutdown)
