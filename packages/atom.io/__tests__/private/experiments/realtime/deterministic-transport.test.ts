import type { Socket } from "atom.io/realtime"
import { SystemClock } from "atom.io/realtime"
import {
	createDeterministicTransport,
	VirtualClock,
} from "atom.io/realtime-testing"

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

	test(`validates timestamps and delays and reports cancellation`, () => {
		expect(() => new VirtualClock({ startAt: Number.NaN })).toThrow(
			`VirtualClock startAt must be finite`,
		)
		const clock = new VirtualClock({ startAt: 10 })
		expect(() => clock.schedule(() => {}, -1)).toThrow(
			`VirtualClock delay must be finite and non-negative`,
		)
		expect(() => clock.advance(-1)).toThrow(
			`VirtualClock advance duration must be finite and non-negative`,
		)
		expect(() => clock.advanceTo(9)).toThrow(
			`VirtualClock cannot move backwards from 10 to 9`,
		)
		expect(() => clock.advanceTo(Number.POSITIVE_INFINITY)).toThrow(
			`VirtualClock cannot move backwards`,
		)

		const task = clock.schedule(() => {}, 5)
		expect(clock.cancel(task)).toBe(true)
		expect(clock.cancel(task)).toBe(false)
		expect(clock.runUntilIdle()).toBe(0)
	})
})

describe(`SystemClock`, () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	test(`runs and cancels scheduled wall-clock work`, () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000)
		const clock = new SystemClock()
		const calls: string[] = []
		const cancelled = clock.schedule(() => calls.push(`cancelled`), 10)
		clock.schedule(() => calls.push(`ran`), 20)

		expect(clock.now()).toBe(1_000)
		expect(clock.cancel(cancelled)).toBe(true)
		expect(clock.cancel(cancelled)).toBe(false)
		vi.advanceTimersByTime(20)
		expect(calls).toEqual([`ran`])
	})

	test(`rejects invalid delays`, () => {
		const clock = new SystemClock()
		expect(() => clock.schedule(() => {}, -1)).toThrow(
			`SystemClock delay must be finite and non-negative`,
		)
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

	test(`advances manual delivery through delayed traffic until idle`, () => {
		const network = createDeterministicTransport({
			mode: `manual`,
			policies: [{ effect: { by: 10, type: `delay` } }],
		})
		const { left, right } = network.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		const received: string[] = []
		right.on(`message`, (value) => received.push(value as string))

		left.emit(`message`, `later`)
		expect(network.runUntilIdle()).toBe(1)
		expect(network.clock.now()).toBe(10)
		expect(received).toEqual([`later`])
	})

	test(`guards manual drains with delivery diagnostics`, () => {
		const network = createDeterministicTransport({
			mode: `manual`,
			policies: [{ effect: { copies: 2, spacing: 5, type: `duplicate` } }],
		})
		const { left } = network.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		left.emit(`message`)
		expect(() => network.runUntilIdle(1)).toThrow(
			/1-delivery safety limit; pending:.*message/,
		)
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
		expect(() => {
			replayPair.left.emit(`different`)
		}).toThrow(/Transport replay mismatch.*expected.*different/)
	})

	test(`diagnoses incomplete and exhausted replay schedules`, () => {
		const original = createDeterministicTransport()
		const originalPair = original.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		originalPair.left.emit(`first`)
		originalPair.left.emit(`second`)

		const replay = createDeterministicTransport({
			replay: original.exportSchedule(),
		})
		const replayPair = replay.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		replayPair.left.emit(`first`)
		expect(() => {
			replay.assertReplayComplete()
		}).toThrow(`Transport replay consumed 1/2 decisions`)
		replayPair.left.emit(`second`)
		expect(() => {
			replayPair.left.emit(`third`)
		}).toThrow(`Transport replay has no decision for envelope 3`)
	})

	test.each([
		[
			`chance`,
			{ chance: 2, effect: { type: `drop` as const } },
			`Fault policy chance must be between 0 and 1`,
		],
		[
			`delay`,
			{ effect: { by: -1, type: `delay` as const } },
			`Fault policy delay must be finite and non-negative`,
		],
		[
			`copies`,
			{ effect: { copies: 1, type: `duplicate` as const } },
			`Duplicate copies must be an integer of at least 2`,
		],
		[
			`spacing`,
			{ effect: { spacing: -1, type: `duplicate` as const } },
			`Fault policy duplicate spacing must be finite and non-negative`,
		],
		[
			`reorder window`,
			{ effect: { type: `reorder` as const, window: 1 } },
			`Reorder window must be an integer of at least 2`,
		],
	] as const)(`rejects invalid %s policies`, (_name, policy, expected) => {
		const network = createDeterministicTransport({ policies: [policy] })
		const { left } = network.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		expect(() => {
			left.emit(`message`)
		}).toThrow(expected)
	})

	test(`classifies peer traffic and array filters`, () => {
		const network = createDeterministicTransport({
			mode: `manual`,
			policies: [
				{
					effect: { type: `drop` },
					filter: {
						event: [`ignored`, `peer-event`],
						from: [`other`, `peer-a`],
						to: [`other`, `peer-b`],
					},
				},
			],
		})
		const { left } = network.createDuplex(
			{ id: `peer-a`, role: `peer` },
			{ id: `peer-b`, role: `peer` },
		)
		left.emit(`peer-event`)
		expect(network.exportSchedule().decisions[0]).toMatchObject({
			envelope: { direction: `peer-to-peer` },
			outcome: { disposition: `drop` },
		})
	})

	test(`counts delivery recursively produced by a delivered envelope`, () => {
		const network = createDeterministicTransport({
			policies: [
				{
					effect: { by: 5, type: `delay` },
					filter: { event: `request` },
				},
			],
		})
		const { left: client, right: server } = network.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		const replies: string[] = []
		server.on(`request`, () => {
			server.emit(`reply`, `done`)
		})
		client.on(`reply`, (reply) => replies.push(reply as string))

		client.emit(`request`)
		expect(network.runUntilIdle()).toBe(2)
		expect(replies).toEqual([`done`])
	})

	test(`drains an incomplete reorder window created during delivery`, () => {
		const network = createDeterministicTransport({
			policies: [
				{
					effect: { by: 5, type: `delay` },
					filter: { event: `request` },
				},
				{
					effect: { type: `reorder`, window: 3 },
					filter: { event: `reply` },
				},
			],
		})
		const { left: client, right: server } = network.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		let replied = false
		server.on(`request`, () => {
			server.emit(`reply`)
		})
		client.on(`reply`, () => {
			replied = true
		})

		client.emit(`request`)
		expect(network.runUntilIdle()).toBe(2)
		expect(replied).toBe(true)
	})

	test(`heals an asymmetric partition and exposes a protocol revision gap`, () => {
		const network = createDeterministicTransport()
		const { left: client, right: server } = network.createDuplex(
			{ id: `client`, role: `client` },
			{ id: `server`, role: `server` },
		)
		let expectedRevision = 1
		const gaps: Array<{ actual: number; expected: number }> = []
		client.on(`revision`, (revision) => {
			if (revision !== expectedRevision) {
				gaps.push({ actual: revision as number, expected: expectedRevision })
			}
			expectedRevision = (revision as number) + 1
		})

		server.emit(`revision`, 1)
		const heal = network.use({
			effect: { type: `partition` },
			filter: { direction: `server-to-client` },
			name: `downstream-only`,
		})
		server.emit(`revision`, 2)
		// The reverse direction remains available during an asymmetric partition.
		let acknowledged = false
		server.on(`ack`, () => {
			acknowledged = true
		})
		client.emit(`ack`)
		expect(acknowledged).toBe(true)

		heal()
		server.emit(`revision`, 3)
		expect(gaps).toEqual([{ actual: 3, expected: 2 }])
		expect(
			network
				.exportSchedule()
				.decisions.map(({ outcome }) => outcome.disposition),
		).toEqual([`deliver`, `partition`, `deliver`, `deliver`])
	})
})
