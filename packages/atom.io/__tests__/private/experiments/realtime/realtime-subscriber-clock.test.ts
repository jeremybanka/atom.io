import type { Socket } from "atom.io/realtime"
import { createSubscriber } from "atom.io/realtime-client"
import {
	createDeterministicTransport,
	VirtualClock,
} from "atom.io/realtime-testing"

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
})
