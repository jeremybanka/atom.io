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

	test(`separates transport queues from registered application work`, async () => {
		const scenario = RTTest.headless({ server: () => {} })
		const client = scenario.createClient({ name: `work-client` })
		let finishWork!: () => void
		const applicationWork = new Promise<void>((resolve) => {
			finishWork = resolve
		})
		void client.work.track(applicationWork, `save draft`)
		try {
			await scenario.drainTransport()
			expect(client.work.pendingLabels()).toEqual([`save draft`])
			finishWork()
			await scenario.drainApplication()
			expect(client.work.pendingLabels()).toEqual([])
		} finally {
			await scenario.teardown()
		}
	})

	test(`drains server application work registered during transport delivery`, async () => {
		let completed = false
		const scenario = RTTest.headless({
			server: ({ socket, work }) => {
				socket.on(`schedule`, () => {
					void work.track(
						Promise.resolve().then(() => {
							completed = true
							socket.emit(`completed`)
						}),
						`server projection`,
					)
				})
			},
		})
		const client = scenario.createClient({ name: `server-work-client` })
		try {
			client.socket.emit(`schedule`)
			await scenario.waitForIdle()
			expect(completed).toBe(true)
			expect(
				scenario.server.journal.count({
					direction: `client:incoming`,
					event: `completed`,
				}),
			).toBe(1)
		} finally {
			await scenario.teardown()
		}
	})

	test(`waits for selected participants to converge`, async () => {
		const scenario = RTTest.headless({ server: () => {} })
		const first = scenario.createClient({ name: `converging-first` })
		const second = scenario.createClient({ name: `converging-second` })
		let serverState = 0
		let firstState = 0
		let secondState = 0
		scenario.server.work.registerDrain(() => {
			serverState = 3
		})
		first.work.registerDrain(() => {
			firstState = 3
		})
		second.work.registerDrain(() => {
			secondState = 3
		})
		try {
			const result = await scenario.waitForConvergence({
				participants: [
					{ label: `server`, read: () => serverState },
					{ label: `first`, read: () => firstState },
					{ label: `second`, read: () => secondState },
				],
			})
			expect(result).toBe(3)
		} finally {
			await scenario.teardown()
		}
	})

	test(`reports divergent participant state with registered diagnostics`, async () => {
		const scenario = RTTest.headless({ server: () => {} })
		const client = scenario.createClient({ name: `divergent-client` })
		scenario.server.inspect(`accepted revision`, () => 8)
		client.inspect(`pending action`, () => `edit-9`)
		try {
			await expect(
				scenario.waitForConvergence({
					participants: [
						{ label: `server value`, read: () => `alpha` },
						{ label: `client value`, read: () => `beta` },
					],
					timeout: 20,
				}),
			).rejects.toThrow(
				/server value.*alpha.*client value.*beta.*accepted revision.*8.*pending action.*edit-9.*Event journal/s,
			)
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
		scenario.server.inspect(`revision`, () => 41)
		client.inspect(`draft`, () => `unsaved`)
		const connectListeners = client.socket.listeners(`connect`).length
		const connectErrorListeners = client.socket.listeners(`connect_error`).length
		try {
			await expect(
				scenario.server.journal.waitForEvent(
					{ event: `never arrives` },
					{ timeout: 10 },
				),
			).rejects.toThrow(/revision.*41.*draft.*unsaved.*Event journal/s)
			await expect(client.waitForIdle({ timeout: 10 })).rejects.toThrow(
				/revision.*41.*draft.*unsaved.*marker.*diagnostic marker/s,
			)
			expect(client.socket.listeners(`connect`)).toHaveLength(connectListeners)
			expect(client.socket.listeners(`connect_error`)).toHaveLength(
				connectErrorListeners,
			)
		} finally {
			await scenario.teardown()
		}
	})

	test(`cancels timed-out transport barriers and ignores late responses`, async () => {
		let timedOutNonce: string | undefined
		const scenario = RTTest.headless({
			server: ({ socket }) => {
				socket.removeAllListeners(`atom.io/realtime-testing:barrier-request`)
				socket.on(
					`atom.io/realtime-testing:barrier-request`,
					(nonce: string) => {
						if (timedOutNonce === undefined) {
							timedOutNonce = nonce
							return
						}
						socket.emit(
							`atom.io/realtime-testing:barrier-response`,
							timedOutNonce,
						)
						socket.emit(`atom.io/realtime-testing:barrier-response`, nonce)
					},
				)
			},
		})
		const client = scenario.createClient({ name: `barrier-timeout` })
		try {
			await new Promise<void>((resolve) => client.socket.on(`connect`, resolve))
			await expect(
				client.drainTransport({ stableRounds: 1, timeout: 10 }),
			).rejects.toThrow(/late response will be ignored/)
			await client.drainTransport({ stableRounds: 1, timeout: 100 })
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
