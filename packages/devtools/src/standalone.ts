import type { Silo } from "atom.io"

import { exposeWholeStore } from "./remote-store.ts"
import {
	encodeStandaloneFrame,
	prepareStandaloneValue,
} from "./standalone-wire.ts"
import { serveViewer, type StandaloneDevtools } from "./viewer-server.ts"

export {
	attachDevtoolsWebSocket,
	type DevtoolsWebSocketOptions,
} from "./devtools-websocket.ts"
export type { StandaloneDevtools } from "./viewer-server.ts"

const maxPendingUpdateBytes = 8 * 1024 * 1024

export interface StandaloneDevtoolsOptions {
	/** An ephemeral port is used when this is omitted or set to zero. */
	port?: number
	/** Explicitly permit inspection when the Silo or Node process is in production. */
	productionAccess?: `inspect`
}

/** Serve the browser viewer for an existing Silo over IPv4 loopback. */
export async function serveDevtoolsStore(
	silo: Silo,
	options: StandaloneDevtoolsOptions = {},
): Promise<StandaloneDevtools> {
	const canInspect = () =>
		options.productionAccess === `inspect` ||
		(!silo.store.config.isProduction && process.env[`NODE_ENV`] !== `production`)
	if (!canInspect()) {
		throw new Error(
			`Standalone devtools requires explicit inspection access in production`,
		)
	}
	return serveViewer(options.port, {
		events(response) {
			if (!canInspect()) {
				response.writeHead(404).end()
				return
			}
			response.writeHead(200, {
				"Content-Type": `text/event-stream; charset=utf-8`,
			})
			let pendingUpdateBytes = 0
			try {
				exposeWholeStore(
					{
						send(frame) {
							if (pendingUpdateBytes > maxPendingUpdateBytes) {
								response.destroy()
								throw new Error(`Standalone devtools client is too slow`)
							}
							const data = `data: ` + encodeStandaloneFrame(frame) + `\n\n`
							if (frame.type === `store`) {
								response.write(data)
								return
							}
							const bytes = Buffer.byteLength(data)
							pendingUpdateBytes += bytes
							response.write(data, () => {
								pendingUpdateBytes -= bytes
							})
						},
						listen(_receive, disconnected) {
							response.once(`close`, disconnected)
						},
						close: () => response.end(),
					},
					silo,
					false,
					prepareStandaloneValue,
				)
			} catch {
				response.destroy()
			}
		},
	})
}
