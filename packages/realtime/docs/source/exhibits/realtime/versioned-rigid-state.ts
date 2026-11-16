import type { Socket } from "@atom.io/realtime"
import { createRigidStateClient } from "@atom.io/realtime/client"
import { createRigidStateServer } from "@atom.io/realtime/server"
import { Silo } from "atom.io"
import { z } from "zod"

const serverStore = new Silo({
	name: `authority`,
	lifespan: `ephemeral`,
	isProduction: false,
})
const clientStore = new Silo({
	name: `browser`,
	lifespan: `ephemeral`,
	isProduction: false,
})
const authoritativeAtom = serverStore.atom<number>({
	key: `authoritative`,
	default: 0,
})
const projectionAtom = clientStore.atom<number>({
	key: `projection`,
	default: 0,
})
const schema = z.number().int().nonnegative()

declare const serverSocket: Socket
declare const clientSocket: Socket
declare const authenticatedUser: string
declare const canRead: (user: string) => boolean
declare const canWrite: (user: string) => boolean

// Create once for this authoritativeAtom resource, then connect authenticated sockets.
const authority = createRigidStateServer({
	store: serverStore.store,
	token: authoritativeAtom,
	schema,
	authorize: (user: string, access) =>
		access === `read` ? canRead(user) : canWrite(user),
})
const disconnect = authority.connect(serverSocket, authenticatedUser)

// Share this controller with all consumers; useRigidState(client) observes it in React.
export const client = createRigidStateClient({
	store: clientStore.store,
	token: projectionAtom,
	resource: authoritativeAtom.key,
	socket: clientSocket,
	schema,
	writable: true,
})
export async function increment(): Promise<void> {
	const snapshot = client.state.snapshot
	if (client.state.status !== `writable` || !snapshot) return
	const result = await client.write(snapshot.value + 1)
	if (result.status === `rejected`) console.info(result.problem.reason)
	// Interrupted means acceptance is unknown; read current state before retrying.
}
export const permissionsChanged = (): void => {
	authority.revalidate()
}
export const dispose = (): void => {
	client.dispose()
	disconnect()
	authority.dispose()
}
