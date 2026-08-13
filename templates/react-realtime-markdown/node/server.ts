import { createServer } from "node:http"

import { Silo } from "atom.io"
import type { UserKey } from "atom.io/realtime"
import { createMosaicServer, realtime } from "atom.io/realtime-server"
import { Server } from "socket.io"

import { identityById } from "../src/identities.ts"
import { markdownServerResource } from "./mosaic-resource.ts"

const PORT = 3000
const mosaic = createMosaicServer({ resources: [markdownServerResource] })
const silo = new Silo({
	name: `markdown-collaboration-server`,
	lifespan: `immortal`,
	isProduction: process.env.NODE_ENV === `production`,
})
const httpServer = createServer((request, response) => {
	if (request.url === `/health`) {
		response.writeHead(200, { "content-type": `application/json` })
		response.end(JSON.stringify({ ok: true }))
		return
	}
	response.writeHead(404)
	response.end()
})
const socketServer = new Server(httpServer)

const disposeRealtime = realtime(
	socketServer,
	(handshake) => {
		const requestedId =
			typeof handshake.auth.userId === `string`
				? handshake.auth.userId
				: undefined
		const sessionId =
			typeof handshake.auth.sessionId === `string`
				? handshake.auth.sessionId
				: undefined
		if (!sessionId || sessionId.includes(`::`)) {
			return new Error(`A valid Mosaic session is required.`)
		}
		const identity = identityById(requestedId)
		return `user::${identity.id}::${sessionId}` satisfies UserKey
	},
	({ socket, consumer }) => {
		const [, actor, session] = consumer.split(`::`)
		if (!actor || !session) {
			throw new Error(`Malformed Mosaic user session.`)
		}
		return mosaic.connect({ actor, session, socket })
	},
	silo.store,
)

httpServer.listen(PORT, () => {
	console.log(
		`Markdown collaboration server listening on http://localhost:${PORT}`,
	)
})

const shutdown = async (): Promise<void> => {
	await disposeRealtime()
	await mosaic.dispose()
}
process.once(`SIGINT`, () => void shutdown())
process.once(`SIGTERM`, () => void shutdown())
