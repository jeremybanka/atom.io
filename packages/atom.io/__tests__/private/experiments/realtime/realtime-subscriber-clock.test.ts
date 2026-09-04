import type { Socket } from "atom.io/realtime"
import {
	createSubscriber,
	getSubMap,
	observeSocketWindDown,
} from "atom.io/realtime-client"
import {
	createDeterministicTransport,
	VirtualClock,
} from "atom.io/realtime-testing/headless"

describe(`createSubscriber clock injection`, () => {
	test(`coalesces unsubscribe and resubscribe under virtual time`, () => {
		const clock = new VirtualClock()
		const network = createDeterministicTransport({ clock })
		const socket: Socket = network.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		).left
		let opens = 0
		let closes = 0
		const open = () => {
			opens++
			return () => {
				closes++
			}
		}

		const releaseFirst = createSubscriber(socket, `document`, open, { clock })
		releaseFirst()
		expect(clock.pending()).toMatchObject([
			{ dueAt: 50, label: `subscription:document` },
		])
		clock.advance(49)
		const releaseSecond = createSubscriber(socket, `document`, open, { clock })
		expect(opens).toBe(1)
		expect(clock.pending()).toEqual([])

		releaseSecond()
		clock.advance(50)
		expect(closes).toBe(1)
	})

	test(`resolves an observed wind-down when resubscription cancels it`, async () => {
		const clock = new VirtualClock()
		const socket: Socket = createDeterministicTransport({ clock }).createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		).left
		const open = () => () => {}

		const releaseFirst = createSubscriber(socket, `document`, open, { clock })
		releaseFirst()
		const windDown = observeSocketWindDown(socket)
		const releaseSecond = createSubscriber(socket, `document`, open, { clock })

		await expect(windDown).resolves.toEqual([`document`])
		releaseSecond()
		clock.runUntilIdle()
	})

	test(`keeps release idempotent and rejects active timing changes`, () => {
		const clock = new VirtualClock()
		const otherClock = new VirtualClock()
		const socket: Socket = createDeterministicTransport({ clock }).createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		).left
		let closes = 0
		const release = createSubscriber(
			socket,
			`document`,
			() => () => {
				closes++
			},
			{ clock, coalesceMs: 25 },
		)

		expect(() =>
			createSubscriber(socket, `document`, () => () => {}, {
				clock: otherClock,
				coalesceMs: 25,
			}),
		).toThrow(`cannot change its clock or coalescing delay while active`)
		expect(() =>
			createSubscriber(socket, `document`, () => () => {}, {
				clock,
				coalesceMs: 50,
			}),
		).toThrow(`cannot change its clock or coalescing delay while active`)

		release()
		release()
		clock.advance(25)
		expect(closes).toBe(1)
	})

	test(`settles wind-down and clears bookkeeping when close throws`, async () => {
		const clock = new VirtualClock()
		const socket: Socket = createDeterministicTransport({ clock }).createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		).left
		const release = createSubscriber(
			socket,
			`document`,
			() => () => {
				throw new Error(`close failed`)
			},
			{ clock },
		)

		release()
		const windDown = observeSocketWindDown(socket)
		expect(() => clock.advance(50)).toThrow(`close failed`)

		await expect(windDown).resolves.toEqual([`document`])
		expect(getSubMap(socket).has(`document`)).toBe(false)
	})
})
