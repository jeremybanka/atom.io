import { Silo } from "atom.io"
import { mosaicDomain } from "atom.io/realtime"
import {
	createMosaicDomainPresenceClient,
	createMosaicDomainPresenceSocketTransport,
	type MosaicDomainPresenceClientSocket,
} from "atom.io/realtime-client"
import {
	bindMosaicDomainPresenceServerSocket,
	createMosaicDomainPresenceServer,
	type MosaicDomainPresenceServerSocket,
} from "atom.io/realtime-server"
import { z } from "zod"

const cursorSchema = z.object({ x: z.number(), y: z.number() })
const serverSilo = new Silo({
	isProduction: true,
	lifespan: `immortal`,
	name: `presence-server`,
})
const clientSilo = new Silo({
	isProduction: true,
	lifespan: `ephemeral`,
	name: `presence-client`,
})
const serverCursorAtoms = serverSilo.atomFamily<
	z.infer<typeof cursorSchema> | null,
	string
>({
	default: null,
	key: `serverCursor`,
})
const clientCursorAtoms = clientSilo.atomFamily<
	z.infer<typeof cursorSchema> | null,
	string
>({
	default: null,
	key: `clientCursor`,
})
const definePresence = (token: typeof serverCursorAtoms) =>
	mosaicDomain({
		configSchema: z.object({}),
		key: `design-presence`,
		members: {
			cursors: {
				keySchema: z.string(),
				role: `ephemeral`,
				schema: cursorSchema,
				token,
			},
		},
		version: 1,
	})

const serverDomain = await definePresence(serverCursorAtoms).activate({
	config: {},
	instance: `poster`,
	store: serverSilo.store,
})
const clientDomain = await definePresence(clientCursorAtoms).activate({
	config: {},
	instance: `poster`,
	store: clientSilo.store,
})
const server = createMosaicDomainPresenceServer({ domain: serverDomain })
const connection = server.connect({ actor: `ada`, session: `tab-1` })

declare const clientSocket: MosaicDomainPresenceClientSocket
declare const serverSocket: MosaicDomainPresenceServerSocket
bindMosaicDomainPresenceServerSocket(connection, serverSocket)
const transport = createMosaicDomainPresenceSocketTransport(clientSocket)
const presence = createMosaicDomainPresenceClient({
	domain: clientDomain,
	session: `tab-1`,
	transport,
})

await presence.start()
await presence.publish(clientDomain.address(`cursors`, `ada/tab-1`), {
	x: 120,
	y: 80,
})
