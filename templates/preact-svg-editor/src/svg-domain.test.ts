import { Silo } from "atom.io"
import {
	createMosaicDomainBatchClient,
	type MosaicDomainBatchClientTransport,
} from "atom.io/realtime-client"
import { createMosaicDomainBatchServer } from "atom.io/realtime-server"
import { afterEach, describe, expect, test, vi } from "vitest"

import { materializeSvgOrder, readSvgRegister } from "./svg-convergence.ts"
import {
	createSvgDomainEditor,
	activateSvgDesignDomain,
	type SvgDomainState,
} from "./svg-domain.ts"
import {
	activeDragAtom,
	createSvgGestureClock,
	nodeAtoms,
	pathDrawSelectors,
	structureViolationsSelector,
	subpathOrderAtoms,
	svgOperationId,
	type SvgDrawingFixture,
} from "./svg-editor-state.ts"

const drawing: SvgDrawingFixture = {
	paths: [
		{
			id: `path-a`,
			subpaths: [
				{ edge: { kind: `move` }, id: `a0`, node: { x: 0, y: 0 } },
				{ edge: { kind: `line` }, id: `a1`, node: { x: 10, y: 10 } },
			],
		},
	],
}

const disposals: Array<() => void> = []

afterEach(() => {
	for (const dispose of disposals.splice(0).reverse()) dispose()
})

async function distributedFixture(
	authorize?: Parameters<typeof createMosaicDomainBatchServer>[0][`authorize`],
) {
	const serverSilo = new Silo({
		isProduction: false,
		lifespan: `ephemeral`,
		name: `svg-domain-server`,
	})
	const aliceSilo = new Silo({
		isProduction: false,
		lifespan: `ephemeral`,
		name: `svg-domain-alice`,
	})
	const bobSilo = new Silo({
		isProduction: false,
		lifespan: `ephemeral`,
		name: `svg-domain-bob`,
	})
	const [serverDomain, aliceDomain, bobDomain] = await Promise.all([
		activateSvgDesignDomain({ instance: `drawing`, silo: serverSilo }),
		activateSvgDesignDomain({ instance: `drawing`, silo: aliceSilo }),
		activateSvgDesignDomain({ instance: `drawing`, silo: bobSilo }),
	])
	const server = createMosaicDomainBatchServer({
		domain: serverDomain,
		...(authorize === undefined ? {} : { authorize }),
	})
	const aliceConnection = server.connect({
		actor: `alice`,
		session: `alice-tab`,
	})
	const bobConnection = server.connect({ actor: `bob`, session: `bob-tab` })
	const alice = createMosaicDomainBatchClient({
		actor: `alice`,
		domain: aliceDomain,
		session: `alice-tab`,
		transport: aliceConnection,
	})
	const bob = createMosaicDomainBatchClient({
		actor: `bob`,
		domain: bobDomain,
		session: `bob-tab`,
		transport: bobConnection,
	})
	await Promise.all([alice.start(), bob.start()])
	const state = (silo: Silo): SvgDomainState => ({
		getState: silo.getState,
		setState: silo.setState,
	})
	const aliceEditor = createSvgDomainEditor({
		batch: alice,
		domain: aliceDomain,
		state: state(aliceSilo),
	})
	const bobEditor = createSvgDomainEditor({
		batch: bob,
		domain: bobDomain,
		state: state(bobSilo),
	})
	disposals.push(
		() => {
			server.dispose()
		},
		() => {
			alice[Symbol.dispose]()
		},
		() => {
			bob[Symbol.dispose]()
		},
		() => {
			serverDomain[Symbol.dispose]()
		},
		() => {
			aliceDomain[Symbol.dispose]()
		},
		() => {
			bobDomain[Symbol.dispose]()
		},
	)
	return {
		alice,
		aliceDomain,
		aliceEditor,
		aliceSilo,
		bob,
		bobDomain,
		bobEditor,
		bobSilo,
		server,
		serverSilo,
	}
}

describe(`SVG Mosaic Domain`, () => {
	test(`heterogeneous reset, split, reorder, and delete batches expose no holes`, async () => {
		const fixture = await distributedFixture()
		const clock = createSvgGestureClock({ actor: `alice`, session: `alice-tab` })
		const observations: unknown[] = []
		const unsubscribe = fixture.aliceSilo.subscribe(
			structureViolationsSelector,
			({ newValue }) => observations.push(newValue),
			`svg-domain-invariants`,
		)
		disposals.push(unsubscribe)
		await fixture.aliceEditor.replaceDrawing({ drawing, gesture: clock.begin() })
		await fixture.aliceEditor.splitSubpath({
			continuationEdge: { kind: `line` },
			gesture: clock.begin(),
			inserted: {
				edge: { kind: `line` },
				node: { x: 5, y: 5 },
				subpathId: `split`,
			},
			pathId: `path-a`,
			targetSubpathId: `a1`,
		})
		await fixture.aliceEditor.reorderSubpath({
			gesture: clock.begin(),
			index: 2,
			pathId: `path-a`,
			subpathId: `split`,
		})
		await fixture.aliceEditor.deleteSubpath({
			gesture: clock.begin(),
			pathId: `path-a`,
			subpathId: `a1`,
		})
		await fixture.bob.flush()

		for (const silo of [
			fixture.serverSilo,
			fixture.aliceSilo,
			fixture.bobSilo,
		]) {
			expect(silo.getState(structureViolationsSelector)).toEqual([])
			expect(silo.getState(pathDrawSelectors, `path-a`)).toBe(`M 0 0 L 5 5`)
		}
		expect(observations.every((value) => JSON.stringify(value) === `[]`)).toBe(
			true,
		)
	})

	test(`independent nodes settle independently and same-node contention converges`, async () => {
		const fixture = await distributedFixture()
		const aliceClock = createSvgGestureClock({
			actor: `alice`,
			initialLogicalTime: 100,
			session: `alice-tab`,
		})
		const bobClock = createSvgGestureClock({
			actor: `bob`,
			initialLogicalTime: 100,
			session: `bob-tab`,
		})
		await fixture.aliceEditor.replaceDrawing({
			drawing,
			gesture: aliceClock.begin(),
		})
		await fixture.bob.flush()
		await Promise.all([
			fixture.aliceEditor.commitGeometry({
				gesture: aliceClock.begin(),
				point: { x: 11, y: 12 },
				target: { kind: `node`, subpathId: `a0` },
			}),
			fixture.bobEditor.commitGeometry({
				gesture: bobClock.begin(),
				point: { x: 21, y: 22 },
				target: { kind: `node`, subpathId: `a1` },
			}),
		])
		await Promise.all([fixture.alice.flush(), fixture.bob.flush()])
		bobClock.observe(102)
		await Promise.all([
			fixture.aliceEditor.commitGeometry({
				gesture: aliceClock.begin(),
				point: { x: 30, y: 30 },
				target: { kind: `node`, subpathId: `a0` },
			}),
			fixture.bobEditor.commitGeometry({
				gesture: bobClock.begin(),
				point: { x: 40, y: 40 },
				target: { kind: `node`, subpathId: `a0` },
			}),
		])
		await Promise.all([fixture.alice.flush(), fixture.bob.flush()])

		for (const silo of [
			fixture.serverSilo,
			fixture.aliceSilo,
			fixture.bobSilo,
		]) {
			expect(readSvgRegister(silo.getState(nodeAtoms, `a0`))).toEqual({
				x: 40,
				y: 40,
			})
			expect(readSvgRegister(silo.getState(nodeAtoms, `a1`))).toEqual({
				x: 21,
				y: 22,
			})
		}
	})

	test(`actor-selective compensation preserves later foreign geometry`, async () => {
		const fixture = await distributedFixture()
		const aliceClock = createSvgGestureClock({
			actor: `alice`,
			session: `alice-tab`,
		})
		const bobClock = createSvgGestureClock({ actor: `bob`, session: `bob-tab` })
		await fixture.aliceEditor.replaceDrawing({
			drawing,
			gesture: aliceClock.begin(),
		})
		await fixture.bob.flush()
		await fixture.aliceEditor.commitGeometry({
			gesture: aliceClock.begin(),
			point: { x: 50, y: 50 },
			target: { kind: `node`, subpathId: `a0` },
		})
		await fixture.bob.flush()
		const aliceOperation = Object.values(
			fixture.bobSilo.getState(nodeAtoms, `a0`).operations,
		).find(({ actor }) => actor === `alice`)!
		const malicious = bobClock.begin()
		await expect(
			fixture.bob.submit(
				{
					address: fixture.bobDomain.address(`nodes`, `a0`),
					id: svgOperationId(malicious, 0),
					operation: {
						actor: `bob`,
						id: svgOperationId(malicious, 0),
						undoTargets: [aliceOperation.id],
						value: { x: 0, y: 0 },
					},
				},
				malicious.id,
			),
		).rejects.toThrow(`only the authenticated actor's operations`)
		bobClock.observe(10)
		await fixture.bobEditor.commitGeometry({
			gesture: bobClock.begin(),
			point: { x: 60, y: 60 },
			target: { kind: `node`, subpathId: `a0` },
		})
		await fixture.alice.flush()
		expect(await fixture.aliceEditor.undo(aliceClock.begin())).toBe(true)
		await fixture.bob.flush()

		for (const silo of [
			fixture.serverSilo,
			fixture.aliceSilo,
			fixture.bobSilo,
		]) {
			expect(readSvgRegister(silo.getState(nodeAtoms, `a0`))).toEqual({
				x: 60,
				y: 60,
			})
		}
		expect(await fixture.aliceEditor.redo(aliceClock.begin())).toBe(true)
		await fixture.bob.flush()
		for (const silo of [
			fixture.serverSilo,
			fixture.aliceSilo,
			fixture.bobSilo,
		]) {
			expect(readSvgRegister(silo.getState(nodeAtoms, `a0`))).toEqual({
				x: 60,
				y: 60,
			})
		}
	})

	test(`redo follows undo order and a new gesture clears the redo suffix`, async () => {
		const fixture = await distributedFixture()
		const clock = createSvgGestureClock({ actor: `alice`, session: `alice-tab` })
		await fixture.aliceEditor.replaceDrawing({ drawing, gesture: clock.begin() })
		await fixture.aliceEditor.commitGeometry({
			gesture: clock.begin(),
			point: { x: 50, y: 50 },
			target: { kind: `node`, subpathId: `a0` },
		})
		await fixture.aliceEditor.commitGeometry({
			gesture: clock.begin(),
			point: { x: 70, y: 70 },
			target: { kind: `node`, subpathId: `a1` },
		})

		expect(await fixture.aliceEditor.undo(clock.begin())).toBe(true)
		expect(await fixture.aliceEditor.undo(clock.begin())).toBe(true)
		expect(readSvgRegister(fixture.aliceSilo.getState(nodeAtoms, `a0`))).toEqual(
			{ x: 0, y: 0 },
		)
		expect(readSvgRegister(fixture.aliceSilo.getState(nodeAtoms, `a1`))).toEqual(
			{ x: 10, y: 10 },
		)

		expect(await fixture.aliceEditor.redo(clock.begin())).toBe(true)
		expect(readSvgRegister(fixture.aliceSilo.getState(nodeAtoms, `a0`))).toEqual(
			{ x: 50, y: 50 },
		)
		expect(readSvgRegister(fixture.aliceSilo.getState(nodeAtoms, `a1`))).toEqual(
			{ x: 10, y: 10 },
		)
		expect(await fixture.aliceEditor.redo(clock.begin())).toBe(true)
		expect(readSvgRegister(fixture.aliceSilo.getState(nodeAtoms, `a1`))).toEqual(
			{ x: 70, y: 70 },
		)

		expect(await fixture.aliceEditor.undo(clock.begin())).toBe(true)
		await fixture.aliceEditor.commitGeometry({
			gesture: clock.begin(),
			point: { x: 80, y: 80 },
			target: { kind: `node`, subpathId: `a0` },
		})
		expect(await fixture.aliceEditor.redo(clock.begin())).toBe(false)
	})

	test(`final-member rejection rolls back the complete structural gesture`, async () => {
		let denyEdges = false
		const fixture = await distributedFixture(
			({ batch }) =>
				!denyEdges ||
				batch.operations.every(({ address }) => address.member !== `edges`),
		)
		const clock = createSvgGestureClock({ actor: `alice`, session: `alice-tab` })
		await fixture.aliceEditor.replaceDrawing({ drawing, gesture: clock.begin() })
		const before = fixture.aliceSilo.getState(pathDrawSelectors, `path-a`)
		denyEdges = true
		await expect(
			fixture.aliceEditor.insertSubpath({
				edge: { kind: `line` },
				gesture: clock.begin(),
				index: 2,
				node: { x: 20, y: 20 },
				pathId: `path-a`,
				subpathId: `rejected`,
			}),
		).rejects.toThrow(`not authorized`)
		expect(fixture.aliceSilo.getState(pathDrawSelectors, `path-a`)).toBe(before)
		expect(fixture.aliceSilo.getState(structureViolationsSelector)).toEqual([])
		expect(fixture.server.revision).toBe(1)
	})

	test(`offline explicit batches replay without losing the coalesced geometry`, async () => {
		const fixture = await distributedFixture()
		const clock = createSvgGestureClock({ actor: `alice`, session: `alice-tab` })
		await fixture.aliceEditor.replaceDrawing({ drawing, gesture: clock.begin() })
		await fixture.bob.flush()
		const connection = fixture.server.connect({
			actor: `offline`,
			session: `offline-tab`,
		})
		const offlineSilo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `svg-domain-offline`,
		})
		const offlineDomain = await activateSvgDesignDomain({
			instance: `drawing`,
			silo: offlineSilo,
		})
		let online = true
		const transport: MosaicDomainBatchClientTransport = {
			propose: (proposal) =>
				online
					? connection.propose(proposal)
					: Promise.reject(new Error(`offline`)),
			recover: (revision) => connection.recover(revision),
			subscribe: (listener) => connection.subscribe(listener),
		}
		const client = createMosaicDomainBatchClient({
			actor: `offline`,
			domain: offlineDomain,
			session: `offline-tab`,
			transport,
		})
		await client.start()
		const editor = createSvgDomainEditor({
			batch: client,
			domain: offlineDomain,
			state: { getState: offlineSilo.getState, setState: offlineSilo.setState },
		})
		online = false
		await editor.commitGeometry({
			gesture: createSvgGestureClock({
				actor: `offline`,
				session: `offline-tab`,
			}).begin(),
			point: { x: 77, y: 88 },
			target: { kind: `node`, subpathId: `a0` },
		})
		expect(client.state.status).toBe(`offline`)
		expect(readSvgRegister(offlineSilo.getState(nodeAtoms, `a0`))).toEqual({
			x: 77,
			y: 88,
		})
		online = true
		await client.flush()
		await fixture.bob.flush()
		expect(readSvgRegister(fixture.bobSilo.getState(nodeAtoms, `a0`))).toEqual({
			x: 77,
			y: 88,
		})
		disposals.push(
			() => {
				client[Symbol.dispose]()
			},
			() => {
				offlineDomain[Symbol.dispose]()
			},
		)
	})

	test(`reset/import ranks only replacement subpaths after planned removals`, async () => {
		const fixture = await distributedFixture()
		const clock = createSvgGestureClock({ actor: `alice`, session: `alice-tab` })
		await fixture.aliceEditor.replaceDrawing({
			drawing,
			gesture: clock.begin(),
		})
		const replacement: SvgDrawingFixture = {
			paths: [
				{
					id: `path-a`,
					subpaths: [
						{ edge: { kind: `move` }, id: `b0`, node: { x: 1, y: 1 } },
						{ edge: { kind: `line` }, id: `b1`, node: { x: 2, y: 2 } },
						{ edge: { kind: `line` }, id: `b2`, node: { x: 3, y: 3 } },
					],
				},
			],
		}
		await fixture.aliceEditor.replaceDrawing({
			drawing: replacement,
			gesture: clock.begin(),
		})
		await fixture.bob.flush()
		for (const silo of [
			fixture.serverSilo,
			fixture.aliceSilo,
			fixture.bobSilo,
		]) {
			expect(
				materializeSvgOrder(silo.getState(subpathOrderAtoms, `path-a`)).map(
					({ value }) => value,
				),
			).toEqual([`b0`, `b1`, `b2`])
			expect(silo.getState(structureViolationsSelector)).toEqual([])
		}
	})

	test(`presence failures never abort local drag or its durable commit`, async () => {
		const fixture = await distributedFixture()
		const clock = createSvgGestureClock({ actor: `alice`, session: `alice-tab` })
		await fixture.aliceEditor.replaceDrawing({
			drawing,
			gesture: clock.begin(),
		})
		const publish = vi.fn(() => Promise.reject(new Error(`presence offline`)))
		const clear = vi.fn(() => Promise.reject(new Error(`presence offline`)))
		const editor = createSvgDomainEditor({
			batch: fixture.alice,
			domain: fixture.aliceDomain,
			presence: { clear, publish } as never,
			state: {
				getState: fixture.aliceSilo.getState,
				setState: fixture.aliceSilo.setState,
			},
		})
		const gesture = clock.begin()
		await expect(
			editor.beginDrag({
				element: {} as Element,
				gesture,
				point: { x: 4, y: 5 },
				pointerId: 1,
				target: { kind: `node`, subpathId: `a0` },
			}),
		).resolves.toBeUndefined()
		await expect(editor.previewDrag({ x: 8, y: 9 })).resolves.toBeUndefined()
		await expect(editor.finishDrag({ commit: true })).resolves.toBeUndefined()
		expect(fixture.aliceSilo.getState(activeDragAtom)).toBeNull()
		expect(readSvgRegister(fixture.aliceSilo.getState(nodeAtoms, `a0`))).toEqual(
			{ x: 8, y: 9 },
		)
		expect(publish).toHaveBeenCalledTimes(2)
		expect(clear).toHaveBeenCalledOnce()
	})
})
