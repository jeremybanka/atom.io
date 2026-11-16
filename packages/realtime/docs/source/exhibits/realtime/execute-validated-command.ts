import { realtimeCommand } from "@atom.io/realtime"
import { createRealtimeCommandClient } from "@atom.io/realtime/client"
import {
	createRealtimeCommandServer,
	realtimeCommandHandler,
} from "@atom.io/realtime/server"
import { z } from "zod"

export const rename = realtimeCommand({
	name: `document.rename`,
	parameters: z.object({ title: z.string().min(1).max(200) }),
	result: z.object({ title: z.string() }),
})

const server = createRealtimeCommandServer({
	handlers: [
		realtimeCommandHandler(rename, {
			authorize: (context) => context.actor === `document-owner`,
			execute: (_context, parameters) => ({ title: parameters.title }),
		}),
	],
})

// In production, derive this context from authenticated transport state.
const authenticated = { actor: `document-owner`, session: `browser-tab-1` }
export const client = createRealtimeCommandClient({
	session: authenticated.session,
	// A real transport forwards the request and returns the server response.
	request: (request) => server.handle(authenticated, request),
})

export const receipt = client.submit(
	rename,
	{ title: `Sketch` },
	`rename-gesture-1`,
)
export const result = receipt.settled
