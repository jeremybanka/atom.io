import { createServer } from "node:http"

import { Server } from "socket.io"

import { identityById } from "../src/identities.ts"
import {
	createMarkdownDocumentService,
	type MarkdownDocumentService,
} from "./service.ts"

export type MarkdownCollaborationHttpServer = {
	close(): Promise<void>
	readonly collaboration: MarkdownDocumentService
}

export async function createMarkdownCollaborationHttpServer(options: {
	readonly collaboration?: MarkdownDocumentService
	readonly port: number
}): Promise<MarkdownCollaborationHttpServer> {
	const collaboration =
		options.collaboration ?? (await createMarkdownDocumentService())
	const httpServer = createServer((request, response) => {
		if (request.url === `/health`) {
			response.writeHead(200, { "content-type": `application/json` })
			response.end(
				JSON.stringify({ ok: true, revision: collaboration.revision }),
			)
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

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error): void => {
			reject(error)
		}
		httpServer.once(`error`, onError)
		httpServer.listen(options.port, `127.0.0.1`, () => {
			httpServer.off(`error`, onError)
			resolve()
		})
	})

	let closed = false
	return {
		async close() {
			if (closed) return
			closed = true
			await new Promise<void>((resolve) =>
				socketServer.close(() => {
					resolve()
				}),
			)
			collaboration[Symbol.dispose]()
		},
		collaboration,
	}
}
