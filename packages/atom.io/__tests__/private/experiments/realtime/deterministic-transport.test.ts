import type { Socket } from "../../../../src/realtime/socket-interface"
import { createDeterministicTransport } from "../../../../src/realtime-testing/deterministic-transport"
import { VirtualClock } from "../../../../src/realtime-testing/virtual-clock"

describe(`VirtualClock`, () => {
	test(`orders tasks without waiting on wall time`, () => {
		const clock = new VirtualClock({ startAt: 100 })
		const events: string[] = []
		clock.schedule(() => events.push(`later`), 20, `later`)
		clock.schedule(() => events.push(`first`), 5, `first`)
		clock.schedule(() => events.push(`second`), 5, `second`)

		expect(clock.pending()).toEqual([
			{ dueAt: 105, id: 2, label: `first` },
			{ dueAt: 105, id: 3, label: `second` },
			{ dueAt: 120, id: 1, label: `later` },
		])
		expect(clock.advance(5)).toBe(2)
		expect(events).toEqual([`first`, `second`])
		expect(clock.now()).toBe(105)
		expect(clock.runUntilIdle()).toBe(1)
		expect(events).toEqual([`first`, `second`, `later`])
		expect(clock.now()).toBe(120)
	})

	test(`reports runaway scheduled work with pending diagnostics`, () => {
		const clock = new VirtualClock({ maxTasksPerRun: 2 })
		const repeat = () => clock.schedule(repeat, 0, `repeat`)
		repeat()
		expect(() => clock.runUntilIdle()).toThrow(
			/2-task safety limit; pending:.*repeat/,
		)
	})

	test(`does not move backwards after a reentrant advance`, () => {
		const clock = new VirtualClock()
		clock.schedule(() => clock.advance(20), 5)
		clock.advance(10)
		expect(clock.now()).toBe(25)
	})
})

describe(`DeterministicTransport`, () => {
	test(`provides Socket-compatible automatic duplex endpoints`, () => {
		const network = createDeterministicTransport()
		const { left: client, right: server } = network.createDuplex(
			{ id: `alice`, role: `client`, session: `tab-1` },
			{ id: `origin`, role: `server`, session: `server-1` },
		)
		const socket: Socket = client
		const received: unknown[] = []
		server.on(`edit`, (...args) => received.push(args))
		socket.emit(`edit`, { text: `hello` })

		expect(received).toEqual([[{ text: `hello` }]])
		expect(network.pending()).toEqual([])
		expect(network.exportSchedule().decisions[0]).toMatchObject({
			envelope: {
				direction: `client-to-server`,
				event: `edit`,
				source: { id: `alice`, session: `tab-1` },
				target: { id: `origin`, session: `server-1` },
			},
			outcome: { disposition: `deliver` },
		})
	})

	test(`manually selects traffic and reverses reorder windows`, () => {
		const network = createDeterministicTransport({
			mode: `manual`,
			policies: [
				{
					effect: { type: `reorder`, window: 3 },
					filter: { event: `ordered` },
					name: `reverse-three`,
				},
			],
		})
		const { left, right } = network.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		const received: number[] = []
		right.on(`ordered`, (value) => received.push(value as number))
		right.on(`priority`, (value) => received.push(value as number))

		left.emit(`ordered`, 1)
		left.emit(`ordered`, 2)
		left.emit(`priority`, 99)
		expect(network.deliverNext({ event: `priority` })?.envelope.event).toBe(
			`priority`,
		)
		left.emit(`ordered`, 3)
		expect(network.pending().map(({ envelope }) => envelope.args[0])).toEqual([
			3, 2, 1,
		])
		expect(network.deliverDue()).toBe(3)
		expect(received).toEqual([99, 3, 2, 1])
	})

	test(`composes scoped delay, duplication, drop, and partition policies`, () => {
		const clock = new VirtualClock()
		const network = createDeterministicTransport({
			clock,
			policies: [
				{
					effect: { by: 10, type: `delay` },
					filter: {
						direction: `client-to-server`,
						event: `edit`,
						from: `alice`,
						predicate: ({ args }) => args[0] === `slow`,
						session: `alice-tab`,
						to: `origin`,
					},
					name: `slow-alice`,
				},
				{
					effect: { copies: 3, spacing: 2, type: `duplicate` },
					filter: { event: `edit` },
					name: `triple-edits`,
				},
				{
					effect: { type: `drop` },
					filter: { event: `discard` },
					name: `packet-loss`,
				},
				{
					effect: { type: `partition` },
					filter: { event: `isolated`, from: `alice` },
					name: `alice-partition`,
				},
			],
		})
		const { left, right } = network.createDuplex(
			{ id: `alice`, role: `client`, session: `alice-tab` },
			{ id: `origin`, role: `server` },
		)
		const received: string[] = []
		right.on(`edit`, (value) => received.push(value as string))
		right.on(`discard`, () => received.push(`discarded`))
		right.on(`isolated`, () => received.push(`isolated`))

		left.emit(`edit`, `slow`)
		left.emit(`discard`)
		left.emit(`isolated`)
		expect(network.pending().map(({ dueAt }) => dueAt)).toEqual([10, 12, 14])
		expect(
			network.exportSchedule().decisions.map((it) => it.outcome.disposition),
		).toEqual([`deliver`, `drop`, `partition`])

		expect(clock.advance(9)).toBe(0)
		expect(received).toEqual([])
		expect(network.runUntilIdle()).toBe(3)
		expect(received).toEqual([`slow`, `slow`, `slow`])
	})

	test(`exports seeded fault decisions that replay independently of policies`, () => {
		const first = createDeterministicTransport({
			policies: [
				{
					chance: 0.5,
					effect: { type: `drop` },
					filter: { event: `message` },
					name: `seeded-loss`,
				},
			],
			seed: 42,
		})
		const firstPair = first.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		for (let value = 0; value < 8; value++) {
			firstPair.left.emit(`message`, value)
		}
		const schedule = first.exportSchedule()
		expect(JSON.parse(JSON.stringify(schedule))).toEqual(schedule)

		const replay = createDeterministicTransport({ replay: schedule })
		const replayPair = replay.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		for (let value = 0; value < 8; value++) {
			replayPair.left.emit(`message`, value)
		}
		replay.assertReplayComplete()
		expect(replay.exportSchedule()).toEqual(schedule)
	})

	test(`diagnoses replay divergence at the first mismatched envelope`, () => {
		const original = createDeterministicTransport()
		const pair = original.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		pair.left.emit(`expected`)

		const replay = createDeterministicTransport({
			replay: original.exportSchedule(),
		})
		const replayPair = replay.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		expect(() => replayPair.left.emit(`different`)).toThrow(
			/Transport replay mismatch.*expected.*different/,
		)
	})
})
