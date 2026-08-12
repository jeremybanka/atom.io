import type * as RT from "atom.io/realtime"
import * as RTTest from "atom.io/realtime-testing"

describe(`realtime testing foundations`, () => {
	test(`creates and disposes headless sessions independently`, async () => {
		const scenario = RTTest.headless({
			server: ({ socket, sessionId }) => {
				socket.on(`identify`, () => socket.emit(`identified`, sessionId))
			},
		})
		const sharedIdentity = `user::shared` as RT.UserKey
		const first = scenario.createClient({
			name: `first-tab`,
			userKey: sharedIdentity,
		})
		const second = scenario.createClient({
			name: `second-tab`,
			userKey: sharedIdentity,
		})
		const other = scenario.createClient({ name: `other-user` })

		try {
			await scenario.waitForIdle()
			expect(first.userKey).toBe(second.userKey)
			expect(first.sessionId).not.toBe(second.sessionId)
			expect(first.silo).not.toBe(second.silo)

			const cursor = scenario.server.journal.cursor()
			first.socket.emit(`identify`)
			second.socket.emit(`identify`)
			other.socket.emit(`identify`)
			await scenario.waitForIdle()

			expect(
				scenario.server.journal.count({
					after: cursor,
					direction: `server:incoming`,
					event: `identify`,
					userKey: sharedIdentity,
				}),
			).toBe(2)

			await first.dispose()
			expect(first.socket.connected).toBe(false)
			expect(second.socket.connected).toBe(true)
			expect(other.socket.connected).toBe(true)
		} finally {
			await scenario.teardown()
		}
	})

	test(`journals repeated occurrences and waits after a cursor`, async () => {
		const scenario = RTTest.headless({ server: () => {} })
		const client = scenario.createClient({ name: `journal-client` })
		try {
			await client.waitForIdle()
			client.socket.emit(`repeat`, 1)
			await client.waitForIdle()
			const cursor = scenario.server.journal.cursor()
			const nextOccurrence = scenario.server.journal.waitForEvent(
				{
					after: cursor,
					direction: `server:incoming`,
					event: `repeat`,
					predicate: (entry) => entry.args[0] === 2,
				},
				{ timeout: 500 },
			)
			client.socket.emit(`repeat`, 2)
			const event = await nextOccurrence

			expect(event.sequence).toBeGreaterThanOrEqual(cursor)
			expect(event.sessionId).toBe(client.sessionId)
			expect(
				scenario.server.journal.count({
					direction: `server:incoming`,
					event: `repeat`,
				}),
			).toBe(2)
			expect(scenario.server.journal.transcript()).toContain(`repeat`)
		} finally {
			await scenario.teardown()
		}
	})

	test(`waitForIdle drains bidirectional cascades`, async () => {
		const scenario = RTTest.headless({
			server: ({ socket }) => {
				socket.on(`start`, () => socket.emit(`middle`))
				socket.on(`finish`, () => socket.emit(`done`))
			},
		})
		const client = scenario.createClient({ name: `cascade-client` })
		client.socket.on(`middle`, () => client.socket.emit(`finish`))
		try {
			client.socket.emit(`start`)
			await client.waitForIdle()
			expect(
				scenario.server.journal.count({
					direction: `client:incoming`,
					event: `done`,
				}),
			).toBe(1)
		} finally {
			await scenario.teardown()
		}
	})

	test(`idle timeout errors include the journal transcript`, async () => {
		const scenario = RTTest.headless({ server: () => {} })
		const client = scenario.createClient({
			autoConnect: false,
			name: `paused-client`,
		})
		scenario.server.journal.record({
			args: [{ reason: `diagnostic marker` }],
			destination: `server`,
			direction: `client:outgoing`,
			event: `marker`,
			sessionId: client.sessionId,
			source: client.sessionId,
			userKey: client.userKey,
		})
		try {
			await expect(client.waitForIdle({ timeout: 10 })).rejects.toThrow(
				/marker.*diagnostic marker/s,
			)
		} finally {
			await scenario.teardown()
		}
	})

	test(`legacy builders can own more than one live instance`, async () => {
		const scenario = RTTest.singleClient({
			client: () => null,
			server: () => {},
		})
		const first = scenario.client.init()
		const second = scenario.client.init()
		try {
			await scenario.waitForIdle()
			expect(first.sessionId).not.toBe(second.sessionId)
			expect(first.userKey).toBe(second.userKey)
			await first.dispose()
			expect(second.socket.connected).toBe(true)
		} finally {
			await scenario.teardown()
		}
	})
})
