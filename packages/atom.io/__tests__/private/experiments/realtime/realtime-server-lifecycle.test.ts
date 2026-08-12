import * as http from "node:http"

import { Silo } from "atom.io"
import { findRelationsInStore, getFromStore, IMPLICIT } from "atom.io/internal"
import type { UserKey } from "atom.io/realtime"
import {
	onlineUsersAtom,
	realtime,
	socketKeysAtom,
	usersOfSockets,
} from "atom.io/realtime-server"
import { Server } from "socket.io"
import { io, type Socket } from "socket.io-client"

const userKey = `user::same-identity` as UserKey

const connect = (port: number): Promise<Socket> =>
	new Promise((resolve, reject) => {
		const socket = io(`http://localhost:${port}`, {
			auth: { username: userKey },
			forceNew: true,
		})
		socket.once(`connect`, () => {
			resolve(socket)
		})
		socket.once(`connect_error`, (error) => {
			socket.close()
			reject(error)
		})
	})

const disconnect = (socket: Socket): Promise<void> =>
	new Promise((resolve) => {
		socket.once(`disconnect`, () => {
			resolve()
		})
		socket.disconnect()
	})

const setup = (
	onConnect: Parameters<typeof realtime>[2] = () => () => {},
	auth: Parameters<typeof realtime>[1] = (handshake) =>
		handshake.auth[`username`] as UserKey,
) => {
	const silo = new Silo(
		{
			name: `realtime-server-lifecycle`,
			lifespan: `ephemeral`,
			isProduction: false,
		},
		IMPLICIT.STORE,
	)
	const httpServer = http.createServer()
	const ioServer = new Server(httpServer)
	const dispose = realtime(ioServer, auth, onConnect, silo.store)
	httpServer.listen()
	const address = httpServer.address()
	if (address === null || typeof address === `string`) throw new Error(`No port`)
	return { silo, port: address.port, dispose }
}

describe(`realtime server lifecycle`, () => {
	test(`keeps an identity online until its final socket disconnects`, async () => {
		const { silo, port, dispose } = setup()
		const tab0 = await connect(port)
		const tab1 = await connect(port)
		await vi.waitFor(() => {
			expect([...getFromStore(silo.store, onlineUsersAtom)]).toEqual([userKey])
			expect(getFromStore(silo.store, socketKeysAtom).size).toBe(2)
			expect(
				getFromStore(
					silo.store,
					findRelationsInStore(silo.store, usersOfSockets, userKey)
						.socketKeysOfUser,
				).length,
			).toBe(2)
		})

		await disconnect(tab0)
		await vi.waitFor(() => {
			expect([...getFromStore(silo.store, onlineUsersAtom)]).toEqual([userKey])
			expect(getFromStore(silo.store, socketKeysAtom).size).toBe(1)
		})

		const reconnectedTab0 = await connect(port)
		await vi.waitFor(() => {
			expect(getFromStore(silo.store, socketKeysAtom).size).toBe(2)
		})
		await disconnect(tab1)
		await vi.waitFor(() => {
			expect([...getFromStore(silo.store, onlineUsersAtom)]).toEqual([userKey])
			expect(getFromStore(silo.store, socketKeysAtom).size).toBe(1)
		})
		await disconnect(reconnectedTab0)
		await vi.waitFor(() => {
			expect(getFromStore(silo.store, onlineUsersAtom).size).toBe(0)
			expect(getFromStore(silo.store, socketKeysAtom).size).toBe(0)
		})
		await dispose()
	})

	test(`observes disconnect during setup and runs late cleanup exactly once`, async () => {
		let resolveSetup: (cleanup: () => void) => void = () => {}
		const cleanup = vi.fn()
		const { silo, port, dispose } = setup(
			() => new Promise((resolve) => (resolveSetup = resolve)),
		)
		const socket = await connect(port)
		await disconnect(socket)
		resolveSetup(cleanup)
		await vi.waitFor(() => {
			expect(cleanup).toHaveBeenCalledOnce()
		})
		expect(getFromStore(silo.store, onlineUsersAtom).size).toBe(0)
		expect(getFromStore(silo.store, socketKeysAtom).size).toBe(0)
		await dispose()
		expect(cleanup).toHaveBeenCalledOnce()
	})

	test(`unwinds rejected setup and close waits for asynchronous cleanup`, async () => {
		const rejected = setup(() => Promise.reject(new Error(`setup rejected`)))
		await connect(rejected.port)
		await vi.waitFor(() => {
			expect(getFromStore(rejected.silo.store, onlineUsersAtom).size).toBe(0)
			expect(getFromStore(rejected.silo.store, socketKeysAtom).size).toBe(0)
		})
		await rejected.dispose()

		let cleanupFinished = false
		const closing = setup(() => async () => {
			await new Promise((resolve) => setTimeout(resolve, 15))
			cleanupFinished = true
		})
		await connect(closing.port)
		await closing.dispose()
		expect(cleanupFinished).toBe(true)
		expect(getFromStore(closing.silo.store, onlineUsersAtom).size).toBe(0)
		expect(getFromStore(closing.silo.store, socketKeysAtom).size).toBe(0)
	})

	test(`reports authentication and cleanup failures without leaking state`, async () => {
		const authentication = setup(
			() => () => {},
			() => Promise.reject(new Error(`auth rejected`)),
		)
		await expect(connect(authentication.port)).rejects.toThrow(`auth rejected`)
		expect(getFromStore(authentication.silo.store, onlineUsersAtom).size).toBe(0)
		expect(getFromStore(authentication.silo.store, socketKeysAtom).size).toBe(0)
		await authentication.dispose()

		const cleanup = setup(() => () => {
			throw new Error(`cleanup rejected`)
		})
		const socket = await connect(cleanup.port)
		await disconnect(socket)
		await vi.waitFor(() => {
			expect(getFromStore(cleanup.silo.store, onlineUsersAtom).size).toBe(0)
			expect(getFromStore(cleanup.silo.store, socketKeysAtom).size).toBe(0)
		})
		await cleanup.dispose()
	})
})
