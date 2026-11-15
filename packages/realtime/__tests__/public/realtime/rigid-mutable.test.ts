import type { RigidMutableStatus } from "@atom.io/realtime"
import {
	pullMutableAtom,
	pullMutableAtomFamilyMember,
} from "@atom.io/realtime/client"
import {
	realtimeMutableFamilyProvider,
	realtimeMutableProvider,
} from "@atom.io/realtime/server"
import {
	createDeterministicTransport,
	VirtualClock,
} from "@atom.io/realtime/testing/headless"
import { Silo } from "atom.io"
import {
	findInStore,
	getFromStore,
	getJsonTokenFromStore,
} from "atom.io/internal"
import { UList } from "atom.io/transceivers/u-list"
import { z } from "zod"

const snapshotSchema = z.array(z.number())
const updateSchema = z.union([
	z.object({ type: z.enum([`add`, `delete`]), value: z.number() }),
	z.object({ type: z.literal(`clear`), values: z.array(z.number()) }),
])
const signalSchema = z.string().refine((value) => {
	try {
		return updateSchema.safeParse(UList.unpackUpdate(value)).success
	} catch {
		return false
	}
})
const tick = async () => {
	for (let i = 0; i < 40; i++) await Promise.resolve()
}
function fixture() {
	const server = new Silo({
		name: `server`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const client = new Silo({
		name: `client`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const numbers = (silo: Silo) =>
		silo.mutableAtom<UList<number>>({ key: `numbers`, class: UList })
	const sourceAtom = numbers(server)
	const targetAtom = numbers(client)
	const clock = new VirtualClock()
	const network = createDeterministicTransport({ clock })
	const pair = network.createDuplex(
		{ id: `client`, role: `client` },
		{ id: `server`, role: `server` },
	)
	const stopServer = realtimeMutableProvider({
		socket: pair.right,
		consumer: `user::a`,
		store: server.store,
	})(sourceAtom)
	const statuses: RigidMutableStatus[] = []
	const stopClient = pullMutableAtom(client.store, pair.left, targetAtom, {
		snapshotSchema,
		signalSchema,
		clock,
		onStatus: (status) => {
			statuses.push(status)
		},
	})
	return {
		server,
		client,
		sourceAtom,
		targetAtom,
		clock,
		network,
		pair,
		statuses,
		value: () =>
			getFromStore(
				client.store,
				getJsonTokenFromStore(client.store, targetAtom),
			),
		dispose() {
			stopClient()
			clock.advance(50)
			stopServer()
		},
	}
}

describe(`versioned mutable streams`, () => {
	test(`hydrates then applies validated deltas in order`, async () => {
		const f = fixture()
		await tick()
		f.server.setState(f.sourceAtom, (previous) => previous.add(1))
		f.server.setState(f.sourceAtom, (previous) => previous.add(2))
		await tick()
		expect(f.value()).toEqual([1, 2])
		expect(f.statuses.at(-1)).toMatchObject({ status: `live`, revision: 2 })
		f.dispose()
	})

	test(`a missing delta triggers a new complete snapshot, not partial application`, async () => {
		const f = fixture()
		await tick()
		const stopDrop = f.network.use({
			effect: { type: `drop` },
			filter: { event: `next:numbers` },
		})
		f.server.setState(f.sourceAtom, (previous) => previous.add(1))
		stopDrop()
		f.server.setState(f.sourceAtom, (previous) => previous.add(2))
		await tick()
		expect(f.value()).toEqual([1, 2])
		expect(
			f.statuses.filter((status) => status.status === `hydrating`),
		).toHaveLength(2)
		f.dispose()
	})

	test(`duplicate and delayed old-subscription deltas cannot corrupt recovery`, async () => {
		const f = fixture()
		await tick()
		const delay = f.network.use({
			effect: { type: `delay`, by: 5 },
			filter: { event: `next:numbers` },
		})
		f.server.setState(f.sourceAtom, (previous) => previous.add(1))
		delay()
		f.network.use({
			effect: { type: `duplicate`, copies: 2 },
			filter: { event: `next:numbers` },
		})
		f.server.setState(f.sourceAtom, (previous) => previous.add(2))
		await tick()
		f.clock.advance(5)
		await tick()
		expect(f.value()).toEqual([1, 2])
		f.dispose()
	})

	test(`invalid signal fails closed without applying the update`, async () => {
		const f = fixture()
		await tick()
		let envelope: unknown
		f.pair.left.on(`next:numbers`, (value) => {
			envelope = value
		})
		f.server.setState(f.sourceAtom, (previous) => previous.add(1))
		await tick()
		f.pair.left.receive(`next:numbers`, [
			{ ...(envelope as object), revision: 2, value: `not-a-set-operation` },
		])
		await tick()
		expect(f.value()).toEqual([1])
		expect(f.statuses.at(-1)?.status).toBe(`failed`)
		f.dispose()
	})

	test(`family revocation invalidates in-flight streams and later grants rehydrate`, async () => {
		const f = fixture()
		const family = (silo: Silo) =>
			silo.mutableAtomFamily<UList<number>, string>({
				key: `family`,
				class: UList,
			})
		const sourceAtoms = family(f.server)
		const targetAtoms = family(f.client)
		const allowedAtom = f.server.atom<string[]>({
			key: `allowed`,
			default: [`a`],
		})
		const stopServer = realtimeMutableFamilyProvider({
			socket: f.pair.right,
			consumer: `user::a`,
			store: f.server.store,
		})(sourceAtoms, allowedAtom)
		const statuses: RigidMutableStatus[] = []
		const stopClient = pullMutableAtomFamilyMember(
			f.client.store,
			f.pair.left,
			targetAtoms,
			`a`,
			{
				snapshotSchema,
				signalSchema,
				clock: f.clock,
				onStatus: (status) => {
					statuses.push(status)
				},
			},
		)
		await tick()
		const sourceAtom = findInStore(f.server.store, sourceAtoms, `a`)
		const targetAtom = findInStore(f.client.store, targetAtoms, `a`)
		const delay = f.network.use({
			effect: { type: `delay`, by: 5 },
			filter: { event: `next:${sourceAtom.key}` },
		})
		f.server.setState(sourceAtom, (previous) => previous.add(1))
		f.server.setState(allowedAtom, [])
		await tick()
		delay()
		f.clock.advance(5)
		await tick()
		expect(
			getFromStore(
				f.client.store,
				getJsonTokenFromStore(f.client.store, targetAtom),
			),
		).toEqual([])
		expect(statuses.at(-1)?.status).toBe(`revoked`)
		f.server.setState(allowedAtom, [`a`])
		await tick()
		expect(
			getFromStore(
				f.client.store,
				getJsonTokenFromStore(f.client.store, targetAtom),
			),
		).toEqual([1])
		expect(statuses.at(-1)?.status).toBe(`live`)
		stopClient()
		f.clock.advance(50)
		stopServer()
		f.dispose()
	})
})

describe(`mutable stream ownership`, () => {
	test(`shares one stream while notifying every compatible observer`, async () => {
		const f = fixture()
		const observed: RigidMutableStatus[] = []
		const stop = pullMutableAtom(f.client.store, f.pair.left, f.targetAtom, {
			snapshotSchema,
			signalSchema,
			clock: f.clock,
			onStatus: (status) => {
				observed.push(status)
			},
		})
		await tick()
		f.server.setState(f.sourceAtom, (previous) => previous.add(4))
		await tick()
		expect(observed.at(-1)).toEqual(f.statuses.at(-1))
		expect(() => {
			pullMutableAtom(f.client.store, f.pair.left, f.targetAtom)
		}).toThrow(`Cannot mix raw and versioned`)
		expect(() => {
			pullMutableAtom(f.client.store, f.pair.left, f.targetAtom, {
				snapshotSchema: z.array(z.number()),
				signalSchema,
				clock: f.clock,
			})
		}).toThrow(`same Store, schemas`)
		stop()
		f.dispose()
	})

	test(`a repeated subscription resends current snapshot with the same epoch`, async () => {
		const f = fixture()
		await tick()
		let request: unknown
		f.pair.left.onAnyOutgoing((event, value) => {
			if (event === `sub:numbers`) request = value
		})
		// A gap causes a fresh nonce, which we retain to simulate a duplicate request.
		const drop = f.network.use({
			effect: { type: `drop` },
			filter: { event: `next:numbers` },
		})
		f.server.setState(f.sourceAtom, (previous) => previous.add(1))
		drop()
		f.server.setState(f.sourceAtom, (previous) => previous.add(2))
		await tick()
		const epoch = f.statuses.at(-1)?.epoch
		const dropAgain = f.network.use({
			effect: { type: `drop` },
			filter: { event: `next:numbers` },
		})
		f.server.setState(f.sourceAtom, (previous) => previous.add(3))
		dropAgain()
		f.pair.left.emit(
			`sub:numbers`,
			request as { protocol: string; subscription: string },
		)
		await tick()
		expect(f.value()).toEqual([1, 2, 3])
		expect(f.statuses.at(-1)?.epoch).toBe(epoch)
		f.dispose()
	})
})

test(`mutable validation uses an owned frame when another listener mutates delivery input`, async () => {
	const f = fixture()
	await tick()
	f.pair.left.on(`next:numbers`, (input) => {
		if (typeof input === `object` && input !== null && !Array.isArray(input))
			Reflect.set(input, `value`, UList.packUpdate({ type: `add`, value: 999 }))
	})
	f.server.setState(f.sourceAtom, (previous) => previous.add(1))
	await tick()
	expect(f.value()).toEqual([1])
	f.dispose()
})
